/**
 * Número de partida NEXA tal como va en la etiqueta: último dígito del año +
 * 6 dígitos de partida (2026, partida 172 → «6000172»). Se usa en todas las
 * pantallas para que el sistema y la etiqueta muestren el mismo número
 * (reunión 10/11/2026). Ver src/lib/codigo-nexa.ts.
 */
import { sql } from "drizzle-orm";
import { partida } from "@/lib/db/schema";

export const partidaNexaSql = sql<string | null>`case when ${partida.id} is null then null else (${partida.anio} % 10)::text || lpad(${partida.numero}::text, 6, '0') end`;
