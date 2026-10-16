/**
 * Movimientos de materia prima entre ubicaciones (minuta 15/10/2026):
 *
 *   Depósito ──retiro──▶ Pie de máquina ──carga──▶ Tolva / en proceso ──consumo──▶ (producción)
 *       ▲                     │                          │
 *       └──── devolución ─────┘        sobrante mezclado ─┘──▶ Depósito (con su código)
 *
 * - Un TRASLADO no cambia el inventario físico total: son dos movimientos
 *   TRANSFERENCIA (−kg en el origen, +kg en el destino) unidos por
 *   `contrapartidaId`, en la misma transacción que los saldos.
 * - El inventario baja sólo por consumo real (cierre de producción),
 *   transformaciones (sobrante), ajustes autorizados y diferencias.
 * - Ningún saldo queda negativo: el origen se bloquea (FOR UPDATE) y se valida.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { movimiento, saldo } from "@/lib/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Origen = (typeof movimiento.$inferInsert)["origen"];

const EPS = 1e-6;

/** Error de validación dentro de una transacción de stock: la revierte entera. */
export class ErrorStock extends Error {}

async function saldoBloqueado(tx: Tx, depositoId: number, mpId: number): Promise<number> {
  const [s] = await tx
    .select({ cantidad: saldo.cantidad })
    .from(saldo)
    .where(and(eq(saldo.depositoId, depositoId), eq(saldo.materiaPrimaId, mpId)))
    .for("update");
  return Number(s?.cantidad ?? 0);
}

async function sumarSaldo(tx: Tx, depositoId: number, mpId: number, delta: number) {
  await tx
    .insert(saldo)
    .values({ depositoId, materiaPrimaId: mpId, cantidad: String(delta) })
    .onConflictDoUpdate({ target: [saldo.depositoId, saldo.materiaPrimaId], set: { cantidad: sql`${saldo.cantidad} + ${delta}`, actualizadoEn: new Date() } });
}

export type MovimientoBase = {
  mpId: number;
  loteMpId?: number | null;
  origen: Origen;
  origenId?: number | null;
  motivo: string;
  usuarioId: number;
  nombreMp?: string;
};

/** Traslado entre ubicaciones: −kg en `desde`, +kg en `hacia`. */
export async function trasladarMp(
  tx: Tx,
  args: MovimientoBase & { desdeId: number; haciaId: number; kg: number; nombreDesde?: string },
): Promise<{ salidaId: number; entradaId: number }> {
  const kg = Math.round(args.kg * 1000) / 1000;
  if (!(kg > 0)) throw new ErrorStock("La cantidad a trasladar tiene que ser mayor que cero.");
  const hay = await saldoBloqueado(tx, args.desdeId, args.mpId);
  if (kg > hay + EPS) {
    throw new ErrorStock(`${args.nombreDesde ?? "En el origen"} hay ${hay} kg${args.nombreMp ? ` de ${args.nombreMp}` : ""}: no alcanza para ${kg} kg.`);
  }
  const base = {
    tipo: "TRANSFERENCIA" as const,
    materiaPrimaId: args.mpId,
    loteMpId: args.loteMpId ?? null,
    origen: args.origen,
    origenId: args.origenId ?? null,
    motivo: args.motivo,
    usuarioId: args.usuarioId,
  };
  const [salida] = await tx.insert(movimiento).values({ ...base, depositoId: args.desdeId, cantidad: String(-kg) }).returning({ id: movimiento.id });
  const [entrada] = await tx
    .insert(movimiento)
    .values({ ...base, depositoId: args.haciaId, cantidad: String(kg), contrapartidaId: salida.id })
    .returning({ id: movimiento.id });
  await tx.update(movimiento).set({ contrapartidaId: entrada.id }).where(eq(movimiento.id, salida.id));
  await sumarSaldo(tx, args.desdeId, args.mpId, -kg);
  await sumarSaldo(tx, args.haciaId, args.mpId, kg);
  return { salidaId: salida.id, entradaId: entrada.id };
}

/**
 * Movimiento en una sola ubicación: ENTRADA (+), SALIDA (−), AJUSTE o
 * TRANSFORMACION (con signo). `delta` con signo; valida que no quede negativo.
 */
export async function moverEnUbicacion(
  tx: Tx,
  args: MovimientoBase & { depositoId: number; delta: number; tipo: "ENTRADA" | "SALIDA" | "AJUSTE" | "TRANSFORMACION"; contrapartidaId?: number | null; nombreUbicacion?: string },
): Promise<number> {
  const delta = Math.round(args.delta * 1000) / 1000;
  if (delta === 0) throw new ErrorStock("El movimiento no puede ser cero.");
  if (delta < 0) {
    const hay = await saldoBloqueado(tx, args.depositoId, args.mpId);
    if (hay + delta < -EPS) {
      throw new ErrorStock(`${args.nombreUbicacion ?? "En la ubicación"} hay ${hay} kg${args.nombreMp ? ` de ${args.nombreMp}` : ""}: no alcanza para descontar ${-delta} kg.`);
    }
  }
  const signado = args.tipo === "AJUSTE" || args.tipo === "TRANSFORMACION";
  const [m] = await tx
    .insert(movimiento)
    .values({
      tipo: args.tipo,
      depositoId: args.depositoId,
      materiaPrimaId: args.mpId,
      loteMpId: args.loteMpId ?? null,
      cantidad: String(signado ? delta : Math.abs(delta)),
      origen: args.origen,
      origenId: args.origenId ?? null,
      contrapartidaId: args.contrapartidaId ?? null,
      motivo: args.motivo,
      usuarioId: args.usuarioId,
    })
    .returning({ id: movimiento.id });
  await sumarSaldo(tx, args.depositoId, args.mpId, delta);
  return m.id;
}

/** Reparte `total` (kg) en partes proporcionales a `pesos`, en gramos exactos. */
export function repartirProporcional(total: number, pesos: number[]): number[] {
  const g = Math.round(total * 1000);
  const suma = pesos.reduce((t, p) => t + p, 0);
  if (suma <= 0) return pesos.map(() => 0);
  const partes = pesos.map((p) => Math.floor((g * p) / suma));
  let resto = g - partes.reduce((t, p) => t + p, 0);
  // El resto (gramos sueltos del redondeo) va a los de mayor peso.
  const orden = pesos.map((p, i) => [p, i] as const).filter(([p]) => p > 0).sort((a, b) => b[0] - a[0]);
  for (let k = 0; resto > 0; k = (k + 1) % orden.length, resto--) partes[orden[k][1]]++;
  return partes.map((p) => p / 1000);
}
