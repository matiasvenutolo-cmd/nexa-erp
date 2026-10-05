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
  movimiento,
  saldo,
  despacho,
  despachoLinea,
} from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { puedeCambiarPrioridad } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";

type EstadoPedido = (typeof pedido.$inferSelect)["estado"];

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

export type DespachoResumen = {
  id: number;
  numeroInterno: number;
  numeroRemito: string | null;
  fecha: string;
};

export type PedidoConDetalle = typeof pedido.$inferSelect & {
  clienteNombre: string;
  lineas: LineaPedidoConProducto[];
  despachos: DespachoResumen[];
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

  const despachos = await db
    .select({
      id: despacho.id,
      numeroInterno: despacho.numeroInterno,
      numeroRemito: despacho.numeroRemito,
      fecha: despacho.fecha,
    })
    .from(despacho)
    .where(eq(despacho.pedidoId, id))
    .orderBy(despacho.numeroInterno);

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
    despachos,
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
 * PEDIDO → EN_ARMADO → LISTO_PARA_DESPACHAR son transiciones de coordinación,
 * sin efecto en el stock (la reserva ya se hizo al crear el pedido). El
 * movimiento real recién ocurre al entregar — ver `marcarEntregado`.
 */
const TRANSICIONES: Record<EstadoPedido, EstadoPedido[]> = {
  PEDIDO: ["EN_ARMADO", "CANCELADO"],
  EN_ARMADO: ["LISTO_PARA_DESPACHAR", "CANCELADO"],
  LISTO_PARA_DESPACHAR: ["ENTREGADO", "CANCELADO"],
  PARCIALMENTE_DESPACHADO: ["ENTREGADO", "CANCELADO"],
  ENTREGADO: [],
  CANCELADO: [],
};

export function transicionesDesde(estado: EstadoPedido): EstadoPedido[] {
  return TRANSICIONES[estado];
}

/** Avanza PEDIDO → EN_ARMADO → LISTO_PARA_DESPACHAR. No toca stock. */
export async function avanzarEstadoPedido(
  pedidoId: number,
  nuevoEstado: "EN_ARMADO" | "LISTO_PARA_DESPACHAR",
): Promise<{ error?: string }> {
  const actual = await db.query.pedido.findFirst({ where: eq(pedido.id, pedidoId) });
  if (!actual) return { error: "Pedido no encontrado." };
  if (!TRANSICIONES[actual.estado].includes(nuevoEstado)) {
    return { error: `No se puede pasar de ${ESTADO_LABEL[actual.estado]} a ${ESTADO_LABEL[nuevoEstado]}.` };
  }
  await db.update(pedido).set({ estado: nuevoEstado }).where(eq(pedido.id, pedidoId));
  return {};
}

/**
 * Entrega el pedido COMPLETO (todas las líneas, cantidad total) en un solo
 * despacho. El despacho parcial con piqueo es R5 (docs/02-modelo-datos.md §6)
 * — esto usa la misma tabla `despacho`/`despachoLinea` ya diseñada para eso,
 * con un único despacho que cubre el 100%, para no reñir con el modelo
 * cuando se construya la versión completa.
 *
 * Es la transición que genera el movimiento de SALIDA real — hasta acá el
 * stock sólo estaba reservado, nunca efectivamente descontado.
 */
export async function marcarEntregado(
  pedidoId: number,
  input: { numeroRemito: string | null; usuarioId: number },
): Promise<{ error?: string }> {
  const depositoId = await getDepositoNexaId();
  const actual = await db.query.pedido.findFirst({ where: eq(pedido.id, pedidoId) });
  if (!actual) return { error: "Pedido no encontrado." };
  if (!TRANSICIONES[actual.estado].includes("ENTREGADO")) {
    return { error: `No se puede entregar un pedido en estado ${ESTADO_LABEL[actual.estado]}.` };
  }

  const lineas = await db.select().from(pedidoLinea).where(eq(pedidoLinea.pedidoId, pedidoId));

  await db.transaction(async (tx) => {
    const [desp] = await tx
      .insert(despacho)
      .values({
        pedidoId,
        numeroRemito: input.numeroRemito,
        fecha: new Date().toISOString().slice(0, 10),
        controladoPorId: input.usuarioId,
      })
      .returning();

    for (const l of lineas) {
      await tx.insert(despachoLinea).values({
        despachoId: desp.id,
        pedidoLineaId: l.id,
        unidades: l.unidadesPedidas,
      });
      await tx
        .update(pedidoLinea)
        .set({ unidadesArmadas: l.unidadesPedidas, unidadesDespachadas: l.unidadesPedidas })
        .where(eq(pedidoLinea.id, l.id));

      if (l.productoId == null) continue;

      await tx.insert(movimiento).values({
        tipo: "SALIDA",
        depositoId,
        productoId: l.productoId,
        cantidad: String(l.unidadesPedidas),
        origen: "PEDIDO",
        origenId: pedidoId,
        motivo: `Entrega pedido ${pedidoId} · remito interno ${remitoInterno(desp.numeroInterno)}${input.numeroRemito ? ` · remito legal ${input.numeroRemito}` : ""}`,
        usuarioId: input.usuarioId,
      });
      await tx
        .insert(saldo)
        .values({ depositoId, productoId: l.productoId, cantidad: String(-l.unidadesPedidas) })
        .onConflictDoUpdate({
          target: [saldo.depositoId, saldo.productoId],
          set: { cantidad: sql`${saldo.cantidad} - ${l.unidadesPedidas}` },
        });

      // La reserva de esta línea ya cumplió su función — se consume, no
      // sigue restando contra el disponible de otros pedidos.
      await tx
        .update(reserva)
        .set({ estado: "CONSUMIDA", cerradoEn: new Date() })
        .where(and(eq(reserva.pedidoLineaId, l.id), eq(reserva.estado, "ABIERTA")));
    }

    await tx.update(pedido).set({ estado: "ENTREGADO" }).where(eq(pedido.id, pedidoId));
  });

  return {};
}

/** Cancela el pedido y libera sus reservas — nunca tocó stock real (nada se
 *  entregó todavía), así que no hay movimiento que revertir. */
export async function cancelarPedido(pedidoId: number): Promise<{ error?: string }> {
  const actual = await db.query.pedido.findFirst({ where: eq(pedido.id, pedidoId) });
  if (!actual) return { error: "Pedido no encontrado." };
  if (actual.estado === "ENTREGADO" || actual.estado === "CANCELADO") {
    return { error: `Un pedido ${ESTADO_LABEL[actual.estado].toLowerCase()} no se puede cancelar.` };
  }

  await db.transaction(async (tx) => {
    const lineas = await tx.select({ id: pedidoLinea.id }).from(pedidoLinea).where(eq(pedidoLinea.pedidoId, pedidoId));
    const lineaIds = lineas.map((l) => l.id);
    if (lineaIds.length > 0) {
      await tx
        .update(reserva)
        .set({ estado: "LIBERADA", cerradoEn: new Date() })
        .where(and(inArray(reserva.pedidoLineaId, lineaIds), eq(reserva.estado, "ABIERTA")));
    }
    await tx.update(pedido).set({ estado: "CANCELADO" }).where(eq(pedido.id, pedidoId));
  });

  return {};
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
      comprometido: sql<string>`sum(${pedidoLinea.unidadesPedidas})`,
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

/** "R-000001": formato del remito interno correlativo. */
export function remitoInterno(n: number): string {
  return `R-${String(n).padStart(6, "0")}`;
}

/**
 * Prioridad de inyección. Definiciones pendientes: "en producción la
 * prioridad de inyección estaría dada automáticamente por las fechas de los
 * pedidos, con opción a ser cambiada por el encargado o supervisor".
 *
 * Automática = orden por fecha de entrega comprometida (o fecha del pedido
 * si no tiene). La excepción manual reutiliza `pedido.prioridad`, que ya
 * existía: 0 = automática, -1 = urgente (pasa adelante de todo). Cada cambio
 * queda auditado con su motivo.
 */
export const PRIORIDAD_URGENTE = -1;
export const PRIORIDAD_AUTOMATICA = 0;

/** Orden de la cola: urgentes primero, después por fecha efectiva de entrega. */
export const ordenPrioridad = [
  pedido.prioridad,
  sql`coalesce(${pedido.fechaEntregaPactada}, ${pedido.fechaPedido})`,
  pedido.fechaPedido,
  pedido.id,
];

export async function cambiarUrgencia(
  actor: Actor,
  pedidoId: number,
  urgente: boolean,
  motivo: string | null,
): Promise<Resultado> {
  if (!puedeCambiarPrioridad(actor.rol)) return { error: "Sólo Encargado o Supervisor pueden cambiar la prioridad." };
  if (urgente && !motivo?.trim()) return { error: "Indicá el motivo de la urgencia: queda registrado." };

  return db.transaction(async (tx) => {
    const [actual] = await tx.select({ prioridad: pedido.prioridad, estado: pedido.estado }).from(pedido).where(eq(pedido.id, pedidoId));
    if (!actual) return { error: "Pedido no encontrado." };
    if (actual.estado === "ENTREGADO" || actual.estado === "CANCELADO") {
      return { error: "Un pedido cerrado no tiene prioridad de inyección." };
    }
    const nueva = urgente ? PRIORIDAD_URGENTE : PRIORIDAD_AUTOMATICA;
    await tx.update(pedido).set({ prioridad: nueva }).where(eq(pedido.id, pedidoId));
    await registrarCambios(tx, actor.id, [
      { entidad: "pedido", entidadId: pedidoId, campo: "prioridad", anterior: actual.prioridad, nuevo: nueva, motivo },
    ]);
    return {};
  });
}
