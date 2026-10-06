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
  pedido,
  pedidoLinea,
  cliente,
  producto,
  reserva,
  saldo,
} from "@/lib/db/schema";
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
export async function asignarProductoALinea(actor: Actor, lineaId: number, productoId: number): Promise<Resultado> {
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
    const [p] = await tx.select({ id: producto.id, codigo: producto.codigo }).from(producto).where(eq(producto.id, productoId));
    if (!p) return { error: "Producto no encontrado." };
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
