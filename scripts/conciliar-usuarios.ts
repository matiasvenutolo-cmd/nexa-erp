/**
 * Conciliación de usuarios con el Excel «NEXA - Usuarios y perfiles» devuelto
 * por el cliente el 22/10/2026 (ver docs/16-mejoras-22-10.md §1).
 *
 * SEGURO POR DISEÑO:
 *  - Por defecto SIMULA: muestra qué cambiaría y no escribe nada.
 *  - Con --aplicar escribe, en una sola transacción, y cada cambio queda en el
 *    historial (auditoria_config) con el motivo. Es idempotente: si se corre
 *    dos veces no duplica personas (busca por email o por nombre).
 *  - No borra a nadie. No genera contraseñas ni PIN: las cuentas nuevas quedan
 *    «pendientes de activación» hasta que Supervisión les cargue la credencial
 *    desde Administración → Usuarios.
 *  - No inventa emails: Adriana Troncoso queda sin email (el del Excel era el
 *    de Sabrina) y entra con PIN cuando se lo carguen.
 *
 * Uso:
 *   npx tsx scripts/conciliar-usuarios.ts            # simulación
 *   npx tsx scripts/conciliar-usuarios.ts --aplicar  # aplica
 */
if (!process.env.DATABASE_URL_UNPOOLED) {
  process.loadEnvFile(".env.local");
}

import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";

type Rol = (typeof schema.usuario.$inferSelect)["rol"];
const MOTIVO = "Conciliación con el Excel de usuarios del cliente (22/10/2026)";
const APLICAR = process.argv.includes("--aplicar");

/** Personas que tienen que existir (nombre como en el Excel, con mayúsculas). */
const ALTAS: { nombre: string; email: string | null; rol: Rol; adicionales?: Rol[] }[] = [
  { nombre: "Braian Laleta", email: "blaleta@cpsudamericana.com", rol: "GERENCIA" },
  { nombre: "Gabriel Laleta", email: "glaleta@cpsudamericana.com", rol: "GERENCIA_CONSULTA" },
  { nombre: "Catalina Laleta", email: "laletacatalina@gmail.com", rol: "GERENCIA" },
  { nombre: "Ailen Grivetto", email: "ailen@cpsudamericana.com", rol: "ADMINISTRACION" },
  // Falta el apellido: se conserva el nombre disponible, sin inventar.
  { nombre: "Carolina", email: "carolina@cpsudamericana.com", rol: "COMPRAS" },
  // El Excel repetía el email de Sabrina: queda sin email hasta que exista el suyo.
  { nombre: "Adriana Troncoso", email: null, rol: "DESPACHO" },
  { nombre: "Ariel Orellano", email: "ariel@nexa.com.ar", rol: "OPERARIO" },
  { nombre: "Octavio Fretes", email: "octavio@nexa.com.ar", rol: "OPERARIO" },
  { nombre: "Franco Uribarri", email: "franco@nexa.com.ar", rol: "OPERARIO" },
  // «nicolas @nexa.com.ar» y «facundo @nexa.com.ar» tenían un espacio.
  { nombre: "Nicolas Acosta", email: "nicolas@nexa.com.ar", rol: "OPERARIO" },
  { nombre: "Facundo Troncoso", email: "facundo@nexa.com.ar", rol: "OPERARIO" },
];

/** Cambios sobre cuentas existentes (se buscan por email actual). */
const CAMBIOS: { emailActual: string; email?: string; rol?: Rol; adicionales?: Rol[]; nota: string }[] = [
  { emailActual: "eduardo@nexa.com.ar", email: "egonzalez@cpsudamericana.com", nota: "email real del Excel (misma contraseña)" },
  { emailActual: "alejandra@nexa.com.ar", email: "alejandra@cpsudamericana.com", nota: "email real del Excel (misma contraseña)" },
  // Dylan y «Dilan Romero» del Excel son la misma persona: una sola cuenta con
  // los tres perfiles (Retiros de MP, Operario y suplencia del Encargado).
  { emailActual: "dylan@nexa.com.ar", rol: "RETIROS_MP", adicionales: ["OPERARIO", "ENCARGADO"], nota: "Dylan = Dilan: perfiles combinados" },
];

/** La cuenta compartida del taller se da de baja (sin borrar su historial). */
const BAJAS = ["Taller"];

async function main() {
  const client = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1 });
  const db = drizzle(client, { schema });
  const { usuario, auditoriaConfig } = schema;
  const [sistema] = await db.select().from(usuario).where(eq(usuario.nombre, "Importación (sistema)")).limit(1);
  if (!sistema) throw new Error("No está el usuario técnico «Importación (sistema)».");
  const todos = await db.select().from(usuario);
  const plan: string[] = [];
  const porEmail = (e: string) => todos.find((u) => u.email?.toLowerCase() === e.toLowerCase());
  const porNombre = (n: string) => todos.find((u) => u.nombre.trim().toLowerCase() === n.toLowerCase());

  for (const a of ALTAS) {
    const ya = (a.email && porEmail(a.email)) || porNombre(a.nombre);
    plan.push(ya ? `= ya existe: ${a.nombre} (id ${ya.id}, ${ya.rol})` : `+ alta: ${a.nombre} · ${a.rol} · ${a.email ?? "sin email"} · pendiente de activación`);
  }
  for (const c of CAMBIOS) {
    const u = porEmail(c.emailActual) ?? (c.email ? porEmail(c.email) : undefined);
    if (!u) plan.push(`! no encontrado: ${c.emailActual}`);
    else plan.push(`~ ${u.nombre}: ${c.nota}${c.email && u.email !== c.email ? ` (${u.email} → ${c.email})` : ""}`);
    if (c.email) {
      const otro = porEmail(c.email);
      if (otro && otro.id !== u?.id) plan.push(`! conflicto: ${c.email} ya lo usa ${otro.nombre}`);
    }
  }
  for (const n of BAJAS) {
    const u = porNombre(n);
    plan.push(!u ? `= no existe la cuenta ${n}` : u.activo ? `- baja (sin borrar historial): ${n} (id ${u.id})` : `= ${n} ya estaba dado de baja`);
  }
  console.log(plan.join("\n"));
  if (plan.some((l) => l.startsWith("!"))) {
    console.log("\nHay conflictos: no se aplica nada.");
    await client.end();
    process.exit(1);
  }
  if (!APLICAR) {
    console.log("\nSimulación: no se escribió nada. Para aplicar: --aplicar");
    await client.end();
    return;
  }

  await db.transaction(async (tx) => {
    const audit = (entidadId: number, campo: string, anterior: string | null, nuevo: string | null) =>
      tx.insert(auditoriaConfig).values({ entidad: "usuario", entidadId: String(entidadId), campo, valorAnterior: anterior, valorNuevo: nuevo, motivo: MOTIVO, usuarioId: sistema.id });
    for (const a of ALTAS) {
      const [ya] = await tx.select().from(usuario).where(a.email ? sql`lower(${usuario.email}) = ${a.email.toLowerCase()} or lower(${usuario.nombre}) = ${a.nombre.toLowerCase()}` : sql`lower(${usuario.nombre}) = ${a.nombre.toLowerCase()}`);
      if (ya) continue;
      const [n] = await tx.insert(usuario).values({ nombre: a.nombre, email: a.email, rol: a.rol, rolesAdicionales: a.adicionales ?? [] }).returning();
      await audit(n.id, "alta", null, `${n.nombre} (${n.rol}) · pendiente de activación`);
    }
    for (const c of CAMBIOS) {
      const [u] = await tx.select().from(usuario).where(sql`lower(${usuario.email}) in (${c.emailActual.toLowerCase()}, ${(c.email ?? c.emailActual).toLowerCase()})`);
      if (!u) continue;
      const set: Partial<typeof usuario.$inferInsert> = {};
      if (c.email && u.email !== c.email) {
        set.email = c.email;
        await audit(u.id, "email", u.email, c.email);
      }
      if (c.rol && u.rol !== c.rol) {
        set.rol = c.rol;
        await audit(u.id, "rol", u.rol, c.rol);
      }
      if (c.adicionales && c.adicionales.join(",") !== u.rolesAdicionales.join(",")) {
        set.rolesAdicionales = c.adicionales;
        await audit(u.id, "perfiles adicionales", u.rolesAdicionales.join(", ") || null, c.adicionales.join(", "));
      }
      if (Object.keys(set).length) await tx.update(usuario).set(set).where(eq(usuario.id, u.id));
    }
    for (const n of BAJAS) {
      const [u] = await tx.select().from(usuario).where(eq(usuario.nombre, n));
      if (!u || !u.activo) continue;
      await tx.update(usuario).set({ activo: false }).where(eq(usuario.id, u.id));
      await audit(u.id, "activo", "true", "false");
    }
  });
  console.log("\nAplicado.");
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
