/**
 * Disponible = saldo − reservas abiertas (docs/02-modelo-datos.md §3
 * `reserva`). Es lo que arregla el bug que el propio cliente detectó en el
 * mockup: dos pedidos del mismo producto no pueden decir ambos "OK para
 * armar" habiendo stock para uno solo.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { saldo, reserva } from "@/lib/db/schema";

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

/** Disponible por producto, para un lote de productos (evita N+1). */
export async function disponiblePorProducto(
  depositoId: number,
  productoIds: number[],
): Promise<Map<number, number>> {
  if (productoIds.length === 0) return new Map();

  const saldos = await db
    .select({ productoId: saldo.productoId, cantidad: saldo.cantidad })
    .from(saldo)
    .where(and(eq(saldo.depositoId, depositoId), inArray(saldo.productoId, productoIds)));

  const reservado = await db
    .select({
      productoId: reserva.productoId,
      total: sql<string>`sum(${reserva.cantidad})`,
    })
    .from(reserva)
    .where(
      and(
        eq(reserva.depositoId, depositoId),
        eq(reserva.estado, "ABIERTA"),
        inArray(reserva.productoId, productoIds),
      ),
    )
    .groupBy(reserva.productoId);

  const reservadoPorProducto = new Map(reservado.map((r) => [r.productoId, Number(r.total)]));
  const disponible = new Map<number, number>();
  for (const s of saldos) {
    if (s.productoId == null) continue;
    const res = reservadoPorProducto.get(s.productoId) ?? 0;
    disponible.set(s.productoId, Number(s.cantidad) - res);
  }
  return disponible;
}
