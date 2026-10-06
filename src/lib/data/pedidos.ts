/**
 * Pedidos — la pantalla central de R1 (docs/03-plan-release-1.md).
 *
 * No se usa el API relacional de Drizzle (`with: {...}`) porque el schema no
 * define `relations()` — mismo criterio que reiner-erp: joins explícitos con
 * `select().leftJoin()`, más simples de leer y de optimizar caso por caso.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  despacho,
  piqueo,
  pedido,
  pedidoLinea,
  cliente,
  producto,
  reserva,
  saldo,
  color,
} from "@/lib/db/schema";
import { claveColor, pareceMulticolor, resolverColorLibre } from "@/lib/catalogo-normalizacion";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { puedeCambiarPrioridad, puedeCrearPedido } from "@/lib/auth/permisos";
import { anularDespachoActivoEnTx } from "@/lib/data/despachos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";

export type FilaPedido = {
  id: number;
  numeroOrden: string | null;
  clienteNombre: string;
  fechaPedido: string;
  estado: (typeof pedido.$inferSelect)["estado"];
  prioridad: number;
  total: string | null;
  lineas: number;
};

export async function listarPedidos(estado?: (typeof pedido.$inferSelect)["estado"]): Promise<FilaPedido[]> {
  const filas = await db
    .select({
      id: pedido.id,
      numeroOrden: pedido.numeroOrden,
      clienteNombre: cliente.nombre,
      fechaPedido: pedido.fechaPedido,
      estado: pedido.estado,
      prioridad: pedido.prioridad,
      total: pedido.total,
      lineas: sql<number>`count(${pedidoLinea.id})`.mapWith(Number),
    })
    .from(pedido)
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .leftJoin(pedidoLinea, eq(pedidoLinea.pedidoId, pedido.id))
    .where(estado ? eq(pedido.estado, estado) : undefined)
    .groupBy(pedido.id, cliente.nombre)
    .orderBy(pedido.prioridad, desc(pedido.fechaPedido));

  return filas;
}

export type SituacionPedido = { pendiente: number; sinProducto: number; faltaProducir: number; despachoEnCurso: boolean };
export type CoberturaLinea = { pendiente: number; cubierto: number; faltaProducir: number };

/**
 * Cuánto de lo pendiente de cada renglón cubre el stock actual, repartiendo el
 * stock con el MISMO orden que la cola de producción (prioridad manual y
 * después fecha de entrega comprometida). Lo ya armado en un despacho en curso
 * se cubre primero con su propia mercadería. Así la suma de lo que "falta
 * producir" en los pedidos coincide con el faltante global de cada producto.
 */
export async function coberturaPorLinea(productoIds?: number[]): Promise<Map<number, CoberturaLinea>> {
  const depositoId = await getDepositoNexaId();
  const lineas = await db
    .select({
      lineaId: pedidoLinea.id,
      productoId: pedidoLinea.productoId,
      pendiente: sql<number>`${pedidoLinea.unidadesPedidas} - ${pedidoLinea.unidadesDespachadas}`.mapWith(Number),
    })
    .from(pedidoLinea)
    .innerJoin(pedido, eq(pedidoLinea.pedidoId, pedido.id))
    .where(
      and(
        sql`${pedido.estado} not in ('ENTREGADO', 'CANCELADO')`,
        sql`${pedidoLinea.productoId} is not null`,
        sql`${pedidoLinea.unidadesPedidas} > ${pedidoLinea.unidadesDespachadas}`,
        productoIds ? inArray(pedidoLinea.productoId, productoIds.length ? productoIds : [-1]) : undefined,
      ),
    )
    .orderBy(...ordenPrioridad, pedidoLinea.id);
  const ids = [...new Set(lineas.map((l) => l.productoId!))];
  if (ids.length === 0) return new Map();
  const [saldos, armado] = await Promise.all([
    db.select({ productoId: saldo.productoId, cantidad: saldo.cantidad }).from(saldo).where(and(eq(saldo.depositoId, depositoId), inArray(saldo.productoId, ids))),
    db
      .select({ lineaId: piqueo.pedidoLineaId, total: sql<number>`coalesce(sum(${piqueo.cantidad}), 0)`.mapWith(Number) })
      .from(piqueo)
      .innerJoin(despacho, eq(piqueo.despachoId, despacho.id))
      .where(and(eq(piqueo.tipo, "ARMADO"), eq(piqueo.conAlerta, false), inArray(despacho.estado, ["ARMANDO", "CONTROLADO"])))
      .groupBy(piqueo.pedidoLineaId),
  ]);
  const libre = new Map(saldos.map((x) => [x.productoId!, Number(x.cantidad)]));
  const armadoPorLinea = new Map(armado.map((a) => [a.lineaId!, a.total]));
  const res = new Map<number, CoberturaLinea>();
  // 1) lo armado ya tiene dueño
  for (const l of lineas) {
    const a = Math.min(armadoPorLinea.get(l.lineaId) ?? 0, l.pendiente);
    libre.set(l.productoId!, (libre.get(l.productoId!) ?? 0) - a);
    res.set(l.lineaId, { pendiente: l.pendiente, cubierto: a, faltaProducir: 0 });
  }
  // 2) el resto, por prioridad
  for (const l of lineas) {
    const r = res.get(l.lineaId)!;
    const disponible = Math.max(0, libre.get(l.productoId!) ?? 0);
    const toma = Math.min(disponible, l.pendiente - r.cubierto);
    libre.set(l.productoId!, disponible - toma);
    r.cubierto += toma;
    r.faltaProducir = l.pendiente - r.cubierto;
  }
  return res;
}

/** Situación real de los pedidos abiertos: lo que falta producir (con la
 *  cobertura por prioridad) y los renglones sin producto (datos pendientes). */
export async function situacionPedidos(pedidoIds: number[]): Promise<Map<number, SituacionPedido>> {
  const res = new Map<number, SituacionPedido>();
  if (pedidoIds.length === 0) return res;
  const [lineas, enCursoFilas, cobertura] = await Promise.all([
    db
      .select({
        lineaId: pedidoLinea.id,
        pedidoId: pedidoLinea.pedidoId,
        productoId: pedidoLinea.productoId,
        pendiente: sql<number>`${pedidoLinea.unidadesPedidas} - ${pedidoLinea.unidadesDespachadas}`.mapWith(Number),
      })
      .from(pedidoLinea)
      .where(and(inArray(pedidoLinea.pedidoId, pedidoIds), sql`${pedidoLinea.unidadesPedidas} > ${pedidoLinea.unidadesDespachadas}`)),
    db
      .select({ pedidoId: despacho.pedidoId })
      .from(despacho)
      .where(and(inArray(despacho.pedidoId, pedidoIds), inArray(despacho.estado, ["ARMANDO", "CONTROLADO"]))),
    coberturaPorLinea(),
  ]);
  const enCurso = new Set(enCursoFilas.map((d) => d.pedidoId));
  for (const l of lineas) {
    const s = res.get(l.pedidoId) ?? { pendiente: 0, sinProducto: 0, faltaProducir: 0, despachoEnCurso: enCurso.has(l.pedidoId) };
    s.pendiente += l.pendiente;
    if (l.productoId == null) s.sinProducto += 1;
    else s.faltaProducir += cobertura.get(l.lineaId)?.faltaProducir ?? l.pendiente;
    res.set(l.pedidoId, s);
  }
  return res;
}

export async function contarPedidosPorEstado(): Promise<
  Record<(typeof pedido.$inferSelect)["estado"], number>
> {
  const filas = await db
    .select({ estado: pedido.estado, n: sql<number>`count(*)`.mapWith(Number) })
    .from(pedido)
    .groupBy(pedido.estado);

  const base = {
    PEDIDO: 0,
    EN_ARMADO: 0,
    LISTO_PARA_DESPACHAR: 0,
    PARCIALMENTE_DESPACHADO: 0,
    ENTREGADO: 0,
    CANCELADO: 0,
  };
  for (const f of filas) base[f.estado] = f.n;
  return base;
}

export type LineaPedidoConProducto = typeof pedidoLinea.$inferSelect & {
  productoCodigo: string | null;
  productoDescripcion: string | null;
  productoEsAccesorio: boolean | null;
  productoUnidadesPorCaja: number | null;
};

export type PedidoConDetalle = typeof pedido.$inferSelect & {
  clienteNombre: string;
  lineas: LineaPedidoConProducto[];
};

export async function obtenerPedido(id: number): Promise<PedidoConDetalle | null> {
  const [cabecera] = await db
    .select({ pedido, clienteNombre: cliente.nombre })
    .from(pedido)
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .where(eq(pedido.id, id));
  if (!cabecera) return null;

  const lineas = await db
    .select({
      linea: pedidoLinea,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
      productoEsAccesorio: producto.esAccesorio,
      productoUnidadesPorCaja: producto.unidadesPorCaja,
    })
    .from(pedidoLinea)
    .leftJoin(producto, eq(pedidoLinea.productoId, producto.id))
    .where(eq(pedidoLinea.pedidoId, id));


  return {
    ...cabecera.pedido,
    clienteNombre: cabecera.clienteNombre,
    lineas: lineas.map((l) => ({
      ...l.linea,
      productoCodigo: l.productoCodigo,
      productoDescripcion: l.productoDescripcion,
      productoEsAccesorio: l.productoEsAccesorio,
      productoUnidadesPorCaja: l.productoUnidadesPorCaja,
    })),
  };
}

export type NuevaLineaInput = {
  productoId: number | null;
  colorTexto: string | null;
  unidadesPedidas: number;
};

export type NuevoPedidoInput = {
  clienteId: number;
  fechaPedido: string;
  fechaEntregaPactada: string | null;
  numeroOrden: string | null;
  contacto: string | null;
  domicilioEntrega: string | null;
  modoEntrega: string | null;
  requiereColocacion: boolean;
  metodoPago: string | null;
  total: string | null;
  senia: string | null;
  numeroComprobante: string | null;
  observaciones: string | null;
  usuarioId: number;
  lineas: NuevaLineaInput[];
};

/**
 * Crea el pedido y, por cada línea con SKU resuelto, su reserva de stock —
 * en la misma transacción. Es la pieza que faltaba para que el bug que
 * detectó el cliente en el mockup no pueda volver a pasar: a partir de acá,
 * cargar un pedido reserva stock de verdad (docs/02-modelo-datos.md §3
 * `reserva`), no sólo lo descuenta al armar.
 */
export async function crearPedido(input: NuevoPedidoInput): Promise<{ id: number } | { error: string }> {
  // Cada renglón es un producto concreto: nunca un texto libre del tipo
  // "Negro, blanco y rojo" (Definiciones pendientes, respuesta 6). Las líneas
  // históricas sin producto vienen sólo del importador del Excel viejo.
  if (input.lineas.length === 0) return { error: "El pedido no tiene ítems." };
  if (input.lineas.some((l) => l.productoId == null)) {
    return { error: "Cada ítem tiene que ser un producto del catálogo, con su color y su cantidad." };
  }
  if (input.lineas.some((l) => !Number.isInteger(l.unidadesPedidas) || l.unidadesPedidas <= 0)) {
    return { error: "Cada ítem tiene que tener una cantidad mayor que cero." };
  }
  const depositoId = await getDepositoNexaId();

  return db.transaction(async (tx) => {
    const [nuevo] = await tx
      .insert(pedido)
      .values({
        clienteId: input.clienteId,
        fechaPedido: input.fechaPedido,
        fechaEntregaPactada: input.fechaEntregaPactada,
        numeroOrden: input.numeroOrden,
        estado: "PEDIDO",
        contacto: input.contacto,
        domicilioEntrega: input.domicilioEntrega,
        modoEntrega: input.modoEntrega,
        requiereColocacion: input.requiereColocacion,
        metodoPago: input.metodoPago,
        total: input.total,
        senia: input.senia,
        numeroComprobante: input.numeroComprobante,
        observaciones: input.observaciones,
        usuarioId: input.usuarioId,
      })
      .returning();

    for (const l of input.lineas) {
      const [linea] = await tx
        .insert(pedidoLinea)
        .values({
          pedidoId: nuevo.id,
          productoId: l.productoId,
          colorTexto: l.colorTexto,
          unidadesPedidas: l.unidadesPedidas,
        })
        .returning();

      if (l.productoId != null) {
        await tx.insert(reserva).values({
          depositoId,
          productoId: l.productoId,
          pedidoLineaId: linea.id,
          cantidad: String(l.unidadesPedidas),
        });
      }
    }

    return { id: nuevo.id };
  });
}

/**
 * Cancela el pedido: libera las reservas abiertas y anula el despacho que esté
 * en curso. Lo que ya se entregó en despachos anteriores no se toca (salió de
 * verdad y tiene su remito).
 */
export async function cancelarPedido(actor: Actor, pedidoId: number): Promise<Resultado> {
  if (!puedeCrearPedido(actor.rol)) return { error: "No tenés permiso para cancelar pedidos." };
  return db.transaction(async (tx) => {
    const [actual] = await tx.select().from(pedido).where(eq(pedido.id, pedidoId));
    if (!actual) return { error: "Pedido no encontrado." };
    if (actual.estado === "ENTREGADO" || actual.estado === "CANCELADO") {
      return { error: `Un pedido ${ESTADO_LABEL[actual.estado].toLowerCase()} no se puede cancelar.` };
    }
    const anulado = await anularDespachoActivoEnTx(tx, actor, pedidoId);
    if (anulado.error) return anulado;
    // Se vuelve a leer con bloqueo: un control final pudo cerrar el pedido mientras tanto.
    const [vigente] = await tx.select({ estado: pedido.estado }).from(pedido).where(eq(pedido.id, pedidoId)).for("update");
    if (vigente.estado === "ENTREGADO" || vigente.estado === "CANCELADO") {
      return { error: `Un pedido ${ESTADO_LABEL[vigente.estado].toLowerCase()} no se puede cancelar.` };
    }
    const lineas = await tx.select({ id: pedidoLinea.id }).from(pedidoLinea).where(eq(pedidoLinea.pedidoId, pedidoId));
    const lineaIds = lineas.map((l) => l.id);
    if (lineaIds.length > 0) {
      await tx
        .update(reserva)
        .set({ estado: "LIBERADA", cerradoEn: new Date() })
        .where(and(inArray(reserva.pedidoLineaId, lineaIds), eq(reserva.estado, "ABIERTA")));
    }
    await tx.update(pedido).set({ estado: "CANCELADO" }).where(eq(pedido.id, pedidoId));
    return {};
  });
}

/**
 * Asigna el producto a un renglón histórico importado sin producto (el Excel
 * viejo traía colores como texto: "Gris oscuro y amarillo"). Sin esto, ese
 * renglón no se puede armar ni despachar. Reserva lo que queda pendiente.
 */
/**
 * Qué se puede vincular a un renglón histórico según su texto del Excel:
 * - texto con varios colores ("gris oscuro y violeta") para una sola cantidad:
 *   nada — falta la cantidad por color, es un dato a resolver con el cliente;
 * - texto con un color reconocible: sólo productos de ese color;
 * - texto que no identifica un color único ("gris"): nada;
 * - sin texto: cualquier producto, dejando registrado cómo se confirmó.
 */
export function compatibilidadRenglon(colorTexto: string | null, coloresConocidos: string[]):
  | { tipo: "multicolor" | "irreconocible"; texto: string }
  | { tipo: "color"; colorNombre: string }
  | { tipo: "sin-dato" } {
  const texto = colorTexto?.trim();
  if (!texto) return { tipo: "sin-dato" };
  if (pareceMulticolor(texto, coloresConocidos) || /\sy\s/i.test(texto)) return { tipo: "multicolor", texto };
  const c = resolverColorLibre(texto);
  return c ? { tipo: "color", colorNombre: c.nombre } : { tipo: "irreconocible", texto };
}

export async function asignarProductoALinea(
  actor: Actor,
  lineaId: number,
  productoId: number,
  confirmacion?: string | null,
): Promise<Resultado> {
  if (!puedeCrearPedido(actor.rol)) return { error: "No tenés permiso para modificar pedidos." };
  const depositoId = await getDepositoNexaId();
  return db.transaction(async (tx) => {
    const [l] = await tx
      .select({ linea: pedidoLinea, estado: pedido.estado })
      .from(pedidoLinea)
      .innerJoin(pedido, eq(pedidoLinea.pedidoId, pedido.id))
      .where(eq(pedidoLinea.id, lineaId));
    if (!l) return { error: "Renglón no encontrado." };
    if (l.linea.productoId != null) return { error: "El renglón ya tiene producto." };
    if (l.estado === "ENTREGADO" || l.estado === "CANCELADO") return { error: "El pedido está cerrado." };
    const [p] = await tx
      .select({ id: producto.id, codigo: producto.codigo, colorNombre: color.nombre })
      .from(producto)
      .innerJoin(color, eq(producto.colorId, color.id))
      .where(eq(producto.id, productoId));
    if (!p) return { error: "Producto no encontrado." };
    const conocidos = (await tx.select({ nombre: color.nombre }).from(color)).map((c) => c.nombre);
    const comp = compatibilidadRenglon(l.linea.colorTexto, conocidos);
    if (comp.tipo === "multicolor") {
      return { error: `El renglón dice “${comp.texto}”: varios colores para una sola cantidad. Falta la cantidad por color; no se puede vincular a un producto.` };
    }
    if (comp.tipo === "irreconocible") {
      return { error: `El texto “${comp.texto}” no identifica un único color del catálogo: no se puede vincular sin confirmar el color.` };
    }
    if (comp.tipo === "color" && claveColor(comp.colorNombre) !== claveColor(p.colorNombre)) {
      return { error: `El renglón es color ${comp.colorNombre} y el producto elegido (${p.codigo}) es ${p.colorNombre}.` };
    }
    const fuente = confirmacion?.trim();
    if (comp.tipo === "sin-dato" && !fuente) {
      return { error: "El renglón no tiene color ni producto en el Excel: indicá cómo se confirmó el producto (queda registrado)." };
    }
    await tx.update(pedidoLinea).set({ productoId }).where(eq(pedidoLinea.id, lineaId));
    const pendiente = l.linea.unidadesPedidas - l.linea.unidadesDespachadas;
    if (pendiente > 0) {
      await tx.insert(reserva).values({ depositoId, productoId, pedidoLineaId: lineaId, cantidad: String(pendiente) });
    }
    await registrarCambios(tx, actor.id, [
      {
        entidad: "pedido",
        entidadId: l.linea.pedidoId,
        campo: "producto del renglón",
        anterior: l.linea.colorTexto ?? l.linea.descripcion ?? "sin producto",
        nuevo: p.codigo,
        motivo: fuente || null,
      },
    ]);
    return {};
  });
}

export type EdicionPedidoInput = {
  fechaEntregaPactada: string | null;
  contacto: string | null;
  domicilioEntrega: string | null;
  modoEntrega: string | null;
  requiereColocacion: boolean;
  // Precios: undefined = "no toques esta columna" (quien no ve precios no
  // puede fijarlos), distinto de null = "bórrala".
  metodoPago?: string | null;
  total?: string | null;
  senia?: string | null;
  numeroComprobante?: string | null;
  observaciones: string | null;
};

/** Edita los datos comerciales y de entrega — no las líneas (agregar/quitar
 *  ítems requeriría reconciliar reservas, se deja para una vuelta futura). */
export async function editarPedido(pedidoId: number, input: EdicionPedidoInput): Promise<{ error?: string }> {
  const actual = await db.query.pedido.findFirst({ where: eq(pedido.id, pedidoId) });
  if (!actual) return { error: "Pedido no encontrado." };
  if (actual.estado === "CANCELADO") return { error: "Un pedido cancelado no se puede editar." };

  await db.update(pedido).set(input).where(eq(pedido.id, pedidoId));
  return {};
}

export type FilaComprometido = {
  productoId: number;
  codigo: string;
  descripcion: string;
  comprometido: number;
  stock: number;
  faltaProducir: number;
};

/**
 * "Material comprometido a entregar" — panel del listado de pedidos. Por
 * producto, cuánto suman los pedidos ABIERTOS (ni entregados ni cancelados),
 * contra el stock actual. Es la versión agregada de lo mismo que ya se
 * calcula por pedido en `disponiblePorProducto` (src/lib/data/stock.ts).
 */
export async function materialComprometido(): Promise<FilaComprometido[]> {
  const depositoId = await getDepositoNexaId();

  const comprometidoPorProducto = await db
    .select({
      productoId: pedidoLinea.productoId,
      // Lo pendiente de entregar: con despachos parciales, lo ya entregado no compromete stock.
      comprometido: sql<string>`sum(${pedidoLinea.unidadesPedidas} - ${pedidoLinea.unidadesDespachadas})`,
    })
    .from(pedidoLinea)
    .innerJoin(pedido, eq(pedidoLinea.pedidoId, pedido.id))
    .where(
      and(
        ne(pedido.estado, "ENTREGADO"),
        ne(pedido.estado, "CANCELADO"),
        sql`${pedidoLinea.productoId} is not null`,
      ),
    )
    .groupBy(pedidoLinea.productoId);

  if (comprometidoPorProducto.length === 0) return [];
  const productoIds = comprometidoPorProducto.map((c) => c.productoId!);

  const saldos = await db
    .select({ productoId: saldo.productoId, cantidad: saldo.cantidad })
    .from(saldo)
    .where(and(eq(saldo.depositoId, depositoId), inArray(saldo.productoId, productoIds)));
  const saldoPorProducto = new Map(saldos.map((s) => [s.productoId, Number(s.cantidad)]));

  const productos = await db
    .select({ id: producto.id, codigo: producto.codigo, descripcion: producto.descripcion })
    .from(producto)
    .where(inArray(producto.id, productoIds));
  const productoPorId = new Map(productos.map((p) => [p.id, p]));

  return comprometidoPorProducto
    .map((c) => {
      const p = productoPorId.get(c.productoId!);
      const comprometido = Number(c.comprometido);
      const stock = saldoPorProducto.get(c.productoId!) ?? 0;
      return {
        productoId: c.productoId!,
        codigo: p?.codigo ?? "—",
        descripcion: p?.descripcion ?? "—",
        comprometido,
        stock,
        faltaProducir: Math.max(0, comprometido - stock),
      };
    })
    .sort((a, b) => b.faltaProducir - a.faltaProducir || b.comprometido - a.comprometido);
}

export const ESTADO_LABEL: Record<(typeof pedido.$inferSelect)["estado"], string> = {
  PEDIDO: "Pedido",
  EN_ARMADO: "En armado",
  LISTO_PARA_DESPACHAR: "Listo para despachar",
  PARCIALMENTE_DESPACHADO: "Parcialmente despachado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
};


/**
 * Prioridad de inyección. Definiciones pendientes: "en producción la
 * prioridad de inyección estaría dada automáticamente por las fechas de los
 * pedidos, con opción a ser cambiada por el encargado o supervisor en base a
 * planificación. En ocasiones surgen urgencias...".
 *
 * Automática = orden por fecha de entrega comprometida (o fecha del pedido si
 * no tiene). El ajuste manual reutiliza `pedido.prioridad` (ya existía):
 * 0 = automática; valores negativos adelantan, positivos postergan. Cada
 * cambio queda auditado con valor anterior, nuevo, motivo, quién y cuándo.
 */
export const NIVELES_PRIORIDAD = [
  { valor: -2, etiqueta: "Urgente" },
  { valor: -1, etiqueta: "Adelantado" },
  { valor: 0, etiqueta: "Automática (por fecha)" },
  { valor: 1, etiqueta: "Postergado" },
] as const;

/** Los motivos que nombró el cliente para cambiar la planificación. */
export const MOTIVOS_PRIORIDAD = [
  "Urgencia",
  "Planificación productiva",
  "Agrupar colores",
  "Reducir cambios de matriz o material",
  "Otro",
] as const;

export const PRIORIDAD_AUTOMATICA = 0;

export function etiquetaPrioridad(valor: number): string {
  return NIVELES_PRIORIDAD.find((n) => n.valor === valor)?.etiqueta ?? `Manual (${valor})`;
}

/** Orden de la cola: ajuste manual primero, después por fecha efectiva de entrega. */
export const ordenPrioridad = [
  pedido.prioridad,
  sql`coalesce(${pedido.fechaEntregaPactada}, ${pedido.fechaPedido})`,
  pedido.fechaPedido,
  pedido.id,
];

export async function cambiarPrioridad(
  actor: Actor,
  pedidoId: number,
  nueva: number,
  motivo: string | null,
  detalle?: string | null,
): Promise<Resultado> {
  if (!puedeCambiarPrioridad(actor.rol)) return { error: "Sólo Encargado o Supervisor pueden cambiar la prioridad." };
  if (!NIVELES_PRIORIDAD.some((n) => n.valor === nueva)) return { error: "Nivel de prioridad inválido." };
  const motivoTxt = [motivo?.trim(), detalle?.trim()].filter(Boolean).join(" — ");
  if (!motivoTxt) return { error: "Indicá el motivo del cambio: queda registrado." };

  return db.transaction(async (tx) => {
    const [actual] = await tx.select({ prioridad: pedido.prioridad, estado: pedido.estado }).from(pedido).where(eq(pedido.id, pedidoId));
    if (!actual) return { error: "Pedido no encontrado." };
    if (actual.estado === "ENTREGADO" || actual.estado === "CANCELADO") {
      return { error: "Un pedido cerrado no tiene prioridad de inyección." };
    }
    if (actual.prioridad === nueva) return { error: "El pedido ya tiene esa prioridad." };
    await tx.update(pedido).set({ prioridad: nueva }).where(eq(pedido.id, pedidoId));
    await registrarCambios(tx, actor.id, [
      {
        entidad: "pedido",
        entidadId: pedidoId,
        campo: "prioridad",
        anterior: etiquetaPrioridad(actual.prioridad),
        nuevo: etiquetaPrioridad(nueva),
        motivo: motivoTxt,
      },
    ]);
    return {};
  });
}
