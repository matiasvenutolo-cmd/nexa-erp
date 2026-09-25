import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { deposito } from "@/lib/db/schema";

/** En R1 sólo NEXA está activo (docs/01-analisis.md §3.4) — cacheado por
 *  request para no repetir la consulta en cada pantalla. */
export const getDepositoNexaId = cache(async (): Promise<number> => {
  const row = await db.query.deposito.findFirst({ where: eq(deposito.nombre, "NEXA") });
  if (!row) throw new Error('Falta el depósito "NEXA" — correr npm run db:import-excel');
  return row.id;
});
