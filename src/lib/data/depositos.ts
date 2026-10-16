import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { deposito } from "@/lib/db/schema";

/**
 * Ubicaciones del stock (tabla `deposito`):
 *  - "NEXA": el depósito — producto terminado y la materia prima que
 *    administra Materia prima;
 *  - "Pie de máquina": material retirado del depósito, junto a la inyectora;
 *  - "Tolva / en proceso": material cargado en la máquina, que se consume al
 *    cerrar la producción (minuta 15/10/2026).
 * Cacheadas por request para no repetir la consulta en cada pantalla.
 */
export const DEPOSITO_NEXA = "NEXA";
export const UBICACION_PIE = "Pie de máquina";
export const UBICACION_PROCESO = "Tolva / en proceso";

async function idDe(nombre: string): Promise<number> {
  const row = await db.query.deposito.findFirst({ where: eq(deposito.nombre, nombre) });
  if (!row) throw new Error(`Falta la ubicación "${nombre}" — correr las migraciones (npm run db:migrate)`);
  return row.id;
}

export const getDepositoNexaId = cache(async (): Promise<number> => idDe(DEPOSITO_NEXA));
export const getDepositoPieId = cache(async (): Promise<number> => idDe(UBICACION_PIE));
export const getDepositoProcesoId = cache(async (): Promise<number> => idDe(UBICACION_PROCESO));

/** Las tres ubicaciones de materia prima, en el orden del circuito. */
export async function ubicacionesMp(): Promise<{ deposito: number; pie: number; proceso: number }> {
  const [d, p, t] = await Promise.all([getDepositoNexaId(), getDepositoPieId(), getDepositoProcesoId()]);
  return { deposito: d, pie: p, proceso: t };
}
