import { defineConfig } from "drizzle-kit";

// drizzle-kit corre fuera de Next.js, así que no lee .env.local solo.
if (!process.env.DATABASE_URL_UNPOOLED) {
  process.loadEnvFile(".env.local");
}

// Migraciones con la connection string SIN pgbouncer (gotcha conocido:
// ver memoria "gotcha-payload-drizzle-schema-push" — con la pooled, el
// push de schema falla o queda inconsistente).
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  throw new Error(
    "Falta DATABASE_URL_UNPOOLED. Correr: npx vercel env pull .env.local --environment=preview",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
});
