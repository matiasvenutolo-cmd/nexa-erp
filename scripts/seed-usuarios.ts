/**
 * Siembra los usuarios reales del organigrama — docs/01-analisis.md §3.10,
 * tomado literal del procedimiento firmado por el personal (`data/
 * Procedimientos Nexa .docx`). No son datos de demo: son las 8 personas y
 * roles reales de CPS. Los operarios de planta (turnos, sin nombre
 * individual en el procedimiento) se agregan cuando el cliente los liste.
 *
 * Contraseña/PIN provisorios para arrancar — rotar antes del traspaso a la
 * cuenta de CPS (ver docs/04-runbook-traspaso.md cuando se escriba).
 *
 * Idempotente: upsert por email.
 *
 * Uso: npx tsx scripts/seed-usuarios.ts
 */
if (!process.env.DATABASE_URL_UNPOOLED) {
  process.loadEnvFile(".env.local");
}

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";
import { hashSecret } from "../src/lib/auth/hash";

const PASSWORD_PROVISORIA = "nexa2026";

const PERSONAS: { nombre: string; email: string; rol: (typeof schema.rolEnum.enumValues)[number] }[] = [
  // Los dueños no están nombrados en el procedimiento (que habla de "gerencia"
  // en general) — cuenta genérica hasta tener los nombres reales.
  { nombre: "Gerencia", email: "gerencia@nexa.com.ar", rol: "GERENCIA" },
  { nombre: "Eduardo González", email: "eduardo@nexa.com.ar", rol: "SUPERVISOR" },
  { nombre: "Alejandra Antón", email: "alejandra@nexa.com.ar", rol: "ADMINISTRACION" },
  { nombre: "David Orellano", email: "david@nexa.com.ar", rol: "ENCARGADO" },
  { nombre: "Daniela Tenorio", email: "daniela@nexa.com.ar", rol: "MATERIA_PRIMA" },
  { nombre: "Sabrina Orellano", email: "sabrina@nexa.com.ar", rol: "DESPACHO" },
  { nombre: "Dylan Romero", email: "dylan@nexa.com.ar", rol: "RETIROS_MP" },
  { nombre: "Alejandro Rivero", email: "alejandro@nexa.com.ar", rol: "MATRICES" },
  { nombre: "Yesica Troncoso", email: "yesica@nexa.com.ar", rol: "MOLINO" },
];

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Falta DATABASE_URL_UNPOOLED en .env.local");
const client = postgres(url, { prepare: false });
const db = drizzle(client, { schema });

async function main() {
  const hash = await hashSecret(PASSWORD_PROVISORIA);
  for (const p of PERSONAS) {
    const existente = await db.query.usuario.findFirst({ where: eq(schema.usuario.email, p.email) });
    if (existente) {
      console.log(`Ya existe: ${p.nombre} (${p.email})`);
      continue;
    }
    await db.insert(schema.usuario).values({
      nombre: p.nombre,
      email: p.email,
      rol: p.rol,
      passwordHash: hash,
    });
    console.log(`Creado: ${p.nombre} · ${p.email} · ${p.rol}`);
  }
  console.log(`\nContraseña provisoria para todos: "${PASSWORD_PROVISORIA}" — rotar antes del traspaso.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
