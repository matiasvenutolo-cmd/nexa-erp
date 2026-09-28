/**
 * Disponible = saldo − reservas abiertas (docs/02-modelo-datos.md §3
 * `reserva`). Es lo que arregla el bug que el propio cliente detectó en el
 * mockup: dos pedidos del mismo producto no pueden decir ambos "OK para
 * armar" habiendo stock para uno solo.
 */
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { saldo, reserva, pedidoLinea, movimiento, producto } from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";

export type EstadoSemaforo = "critico" | "bajo" | "ok" | "exceso" | "sin-datos";

export function semaforoStock(
  cantidad: number,
  minimo: number | null,
  maximo: number | null,
): EstadoSemaforo {
  if (minimo == null && maximo == null) return "sin-datos";
  if (minimo != null && cantidad < minimo) return "critico";
  if (minimo != null && cantidad <= minimo * 1.15) return "bajo";
  if (maximo != null && cantidad > maximo) return "exceso";
  return "ok";
}

/**
 * Disponible por producto, para un lote de productos (evita N+1).
 *
 * `excluirPedidoId` es para cuando se mira el detalle de UN pedido puntual:
 * la reserva que ese mismo pedido ya generó no puede jugar en contra de su
 * propia línea (sería mostrar "falta stock" en un pedido cuyo stock el
 * sistema ya le apartó). Sin excluir nada, la función responde "si todos los
 * DEMÁS compromisos abiertos se cubrieran primero, ¿queda para mí" — sigue
 * siendo conservador entre pedidos de terceros (no prioriza por antigüedad
 * todavía, eso es la cola de producción de R3), pero nunca se autopenaliza.
 */
export async function disponiblePorProducto(
  depositoId: number,
  productoIds: number[],
  excluirPedidoId?: number,
): Promise<Map<number, number>> {
  if (productoIds.length === 0) return new Map();

  const saldos = await db
    .select({ productoId: saldo.productoId, cantidad: saldo.cantidad })
    .from(saldo)
    .where(and(eq(saldo.depositoId, depositoId), inArray(saldo.productoId, productoIds)));

  const condicionesReserva = [
    eq(reserva.depositoId, depositoId),
    eq(reserva.estado, "ABIERTA"),
    inArray(reserva.productoId, productoIds),
  ];

  const reservadoQuery = db
    .select({
      productoId: reserva.productoId,
      total: sql<string>`sum(${reserva.cantidad})`,
    })
    .from(reserva);

  const reservado = excluirPedidoId
    ? await reservadoQuery
        .innerJoin(pedidoLinea, eq(reserva.pedidoLineaId, pedidoLinea.id))
        .where(and(...condicionesReserva, ne(pedidoLinea.pedidoId, excluirPedidoId)))
        .groupBy(reserva.productoId)
    : await reservadoQuery.where(and(...condicionesReserva)).groupBy(reserva.productoId);

  const reservadoPorProducto = new Map(reservado.map((r) => [r.productoId, Number(r.total)]));
  const disponible = new Map<number, number>();
  for (const s of saldos) {
    if (s.productoId == null) continue;
    const res = reservadoPorProducto.get(s.productoId) ?? 0;
    disponible.set(s.productoId, Number(s.cantidad) - res);
  }
  return disponible;
}

export type FilaMovimiento = {
  id: number;
  fecha: Date;
  tipo: (typeof movimiento.$inferSelect)["tipo"];
  cantidad: string;
  motivo: string | null;
  productoCodigo: string | null;
  productoDescripcion: string | null;
};

/** Historial de movimientos de PRODUCTOS terminados — la materia prima tiene
 *  el suyo en R4, cuando exista `retiroMp`/`loteMp`. */
export async function listarMovimientosProducto(filtro?: {
  tipo?: (typeof movimiento.$inferSelect)["tipo"];
  productoId?: number;
}): Promise<FilaMovimiento[]> {
  const depositoId = await getDepositoNexaId();
  const condiciones = [eq(movimiento.depositoId, depositoId), sql`${movimiento.productoId} is not null`];
  if (filtro?.tipo) condiciones.push(eq(movimiento.tipo, filtro.tipo));
  if (filtro?.productoId) condiciones.push(eq(movimiento.productoId, filtro.productoId));

  const filas = await db
    .select({
      id: movimiento.id,
      fecha: movimiento.fecha,
      tipo: movimiento.tipo,
      cantidad: movimiento.cantidad,
      motivo: movimiento.motivo,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
    })
    .from(movimiento)
    .leftJoin(producto, eq(movimiento.productoId, producto.id))
    .where(and(...condiciones))
    .orderBy(desc(movimiento.fecha), desc(movimiento.id))
    .limit(200);

  return filas;
}

/**
 * Corrección manual de stock — el recuento físico de los viernes
 * (docs/01-analisis.md §3.6) hasta que exista la pantalla dedicada de
 * inventario (R2 completo la deja como ajuste puntual; `inventarioFisico`
 * como evento recurrente queda para cuando se calibren los mínimos reales).
 * Genera su propio movimiento AJUSTE — nunca se toca `saldo` sin él.
 *
 * A diferencia de ENTRADA/SALIDA (donde `cantidad` siempre se guarda en
 * positivo y el signo lo da el tipo), un AJUSTE puede ir en cualquier
 * dirección, así que acá `cantidad` guarda el delta CON signo — ver
 * `signoCantidad()` para mostrarlo bien en pantalla.
 */
export async function corregirStockManual(input: {
  productoId: number;
  delta: number;
  motivo: string;
  usuarioId: number;
}): Promise<{ error?: string }> {
  if (input.delta === 0) return { error: "El ajuste no puede ser cero." };
  if (!input.motivo.trim()) return { error: "El motivo es obligatorio." };

  const depositoId = await getDepositoNexaId();
  await db.transaction(async (tx) => {
    await tx.insert(movimiento).values({
      tipo: "AJUSTE",
      depositoId,
      productoId: input.productoId,
      cantidad: String(input.delta),
      origen: "MANUAL",
      motivo: input.motivo.trim(),
      usuarioId: input.usuarioId,
    });
    await tx
      .insert(saldo)
      .values({ depositoId, productoId: input.productoId, cantidad: String(input.delta) })
      .onConflictDoUpdate({
        target: [saldo.depositoId, saldo.productoId],
        set: { cantidad: sql`${saldo.cantidad} + ${input.delta}` },
      });
  });
  return {};
}

/** Con qué signo mostrar la cantidad de un movimiento — ENTRADA siempre +,
 *  SALIDA siempre −, AJUSTE ya viene con su propio signo guardado. */
export function signoCantidad(tipo: (typeof movimiento.$inferSelect)["tipo"], cantidad: string): number {
  const n = Number(cantidad);
  if (tipo === "SALIDA") return -Math.abs(n);
  if (tipo === "AJUSTE" || tipo === "TRANSFORMACION") return n;
  return Math.abs(n);
}
