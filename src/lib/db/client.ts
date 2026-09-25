/**
 * Cliente de base de datos — Neon Postgres vía el driver `postgres`.
 *
 * Usa la connection string POOLEADA (DATABASE_URL) para runtime, apta para
 * el modelo serverless de Vercel. Para migraciones y scripts usar la
 * unpooled — ver drizzle.config.ts y scripts/import-excel.ts.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
   
  var __nexaSql: ReturnType<typeof postgres> | undefined;
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "Falta DATABASE_URL. Correr: npx vercel env pull .env.local --environment=preview",
  );
}

// Reutilizar la conexión entre Fast Refresh / invocaciones cálidas en dev.
const client = globalThis.__nexaSql ?? postgres(connectionString, { prepare: false });
if (process.env.NODE_ENV !== "production") globalThis.__nexaSql = client;

export const db = drizzle(client, { schema });
