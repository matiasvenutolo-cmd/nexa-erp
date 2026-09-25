/**
 * Pedidos — la pantalla central de R1 (docs/03-plan-release-1.md).
 *
 * No se usa el API relacional de Drizzle (`with: {...}`) porque el schema no
 * define `relations()` — mismo criterio que reiner-erp: joins explícitos con
 * `select().leftJoin()`, más simples de leer y de optimizar caso por caso.
 */
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pedido, pedidoLinea, cliente, producto, reserva } from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";

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
  numeroOrden: string | null;
  contacto: string | null;
  domicilioEntrega: string | null;
  modoEntrega: string | null;
  requiereColocacion: boolean;
  metodoPago: string | null;
  total: string | null;
  senia: string | null;
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
export async function crearPedido(input: NuevoPedidoInput): Promise<{ id: number }> {
  const depositoId = await getDepositoNexaId();

  return db.transaction(async (tx) => {
    const [nuevo] = await tx
      .insert(pedido)
      .values({
        clienteId: input.clienteId,
        fechaPedido: input.fechaPedido,
        numeroOrden: input.numeroOrden,
        estado: "PEDIDO",
        contacto: input.contacto,
        domicilioEntrega: input.domicilioEntrega,
        modoEntrega: input.modoEntrega,
        requiereColocacion: input.requiereColocacion,
        metodoPago: input.metodoPago,
        total: input.total,
        senia: input.senia,
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

export const ESTADO_LABEL: Record<(typeof pedido.$inferSelect)["estado"], string> = {
  PEDIDO: "Pedido",
  EN_ARMADO: "En armado",
  LISTO_PARA_DESPACHAR: "Listo para despachar",
  PARCIALMENTE_DESPACHADO: "Parcialmente despachado",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
};
