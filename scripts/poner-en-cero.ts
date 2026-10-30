/**
 * Puesta a cero pedida por el cliente (29/10/2026): borrar pedidos, clientes y
 * reclamos cargados, y dejar en 0 el stock de productos terminados.
 *
 * SEGURO POR DISEÑO:
 *  1. Respaldo: exporta TODAS las tablas a respaldos/<fecha>/*.json antes de
 *     cualquier cambio (mismo formato que scripts/puesta-en-marcha.ts).
 *  2. Simulación (por defecto): cuenta lo que se borraría. No escribe nada.
 *  3. Ejecución: sólo con --ejecutar --confirmar=CERO-<AAAA-MM-DD de hoy>.
 *     Todo en una sola transacción (si algo falla, no cambia nada):
 *     - Borra avisos vinculados, reclamos y su historial, piqueos, despachos,
 *       reservas, vínculos tanda/producción ↔ pedido, líneas, pedidos y clientes.
 *     - Stock de terminados: un AJUSTE de INVENTARIO por producto con saldo
 *       (el ledger explica el paso a 0; no se borran movimientos) y las cajas
 *       que seguían vigentes pasan a BAJA (no se pueden volver a piquear).
 *     - Deja constancia en la auditoría.
 *     No toca materia prima, productos, recetas, colores, producciones, tandas
 *     ni usuarios.
 *  --reiniciar-numeracion: los próximos pedidos/clientes/reclamos/despachos
 *     vuelven a empezar en 1 (opcional; los movimientos viejos conservan su
 *     referencia numérica a los despachos borrados).
 *
 * Uso:
 *   npx tsx scripts/poner-en-cero.ts
 *   npx tsx scripts/poner-en-cero.ts --ejecutar --confirmar=CERO-2026-10-29
 */
if (!process.env.DATABASE_URL_UNPOOLED) {
  process.loadEnvFile(".env.local");
}

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, asc, eq, isNotNull, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "1"];
  }),
);
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const ejecutar = args.ejecutar === "1";
const reiniciar = args["reiniciar-numeracion"] === "1";
const fraseEsperada = `CERO-${hoy}`;
if (ejecutar && args.confirmar !== fraseEsperada) {
  console.error(`Para ejecutar hace falta --confirmar=${fraseEsperada} (confirmación explícita).`);
  process.exit(1);
}
const MOTIVO = `Puesta a cero pedida por el cliente (${hoy})`;

const sqlc = postgres(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(sqlc, { schema });

async function respaldar(): Promise<string> {
  const dir = path.join("respaldos", `${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(dir, { recursive: true });
  const tablas = await sqlc<{ table_name: string }[]>`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`;
  for (const { table_name } of tablas) {
    const filas = await sqlc.unsafe(`select * from "${table_name.replace(/"/g, "")}"`);
    writeFileSync(path.join(dir, `${table_name}.json`), JSON.stringify(filas, null, 1));
  }
  return dir;
}

const contar = async (tabla: string, donde = "true") => Number((await sqlc.unsafe(`select count(*)::int n from "${tabla}" where ${donde}`))[0].n);
const AVISO_VINCULADO = "pedido_id is not null or despacho_id is not null or reclamo_id is not null";

async function main() {
  console.log(`\nPuesta a cero · ${ejecutar ? "EJECUCIÓN" : "SIMULACIÓN (no se escribe nada)"}\n`);
  const dir = await respaldar();
  console.log(`1) Respaldo completo en ${dir}/ (una planilla JSON por tabla).\n`);

  const [nexa] = await db.select().from(schema.deposito).where(eq(schema.deposito.nombre, "NEXA"));
  const saldosPt = await db
    .select({ id: schema.saldo.id, depositoId: schema.saldo.depositoId, productoId: schema.saldo.productoId, cantidad: schema.saldo.cantidad })
    .from(schema.saldo)
    .where(and(isNotNull(schema.saldo.productoId), ne(schema.saldo.cantidad, "0")));
  const conteo = {
    pedidos: await contar("pedido"),
    lineas: await contar("pedido_linea"),
    despachos: await contar("despacho"),
    piqueos: await contar("piqueo"),
    reservas: await contar("reserva"),
    vinculosTanda: await contar("tanda_pedido"),
    vinculosProduccion: await contar("ciclo_pedido"),
    reclamos: await contar("reclamo"),
    avisos: await contar("aviso", AVISO_VINCULADO),
    clientes: await contar("cliente"),
    coloresDeCliente: await contar("color", "cliente_id is not null"),
    cajasVigentes: await contar("caja", "estado <> 'BAJA'"),
  };
  const unidades = saldosPt.reduce((t, s) => t + Number(s.cantidad), 0);
  console.log("2) Se borraría:");
  console.log(`   · Pedidos: ${conteo.pedidos} (${conteo.lineas} líneas, ${conteo.despachos} despachos, ${conteo.piqueos} piqueos, ${conteo.reservas} reservas)`);
  console.log(`   · Vínculos de planificación con pedidos: ${conteo.vinculosTanda} de tandas y ${conteo.vinculosProduccion} de producciones (las tandas y producciones quedan)`);
  console.log(`   · Reclamos: ${conteo.reclamos} · Avisos vinculados: ${conteo.avisos}`);
  console.log(`   · Clientes: ${conteo.clientes}`);
  console.log(`\n3) Stock de productos terminados a 0: ${saldosPt.length} productos, ${unidades} unidades (un ajuste de inventario por producto); ${conteo.cajasVigentes} cajas pasan a BAJA.`);
  if (saldosPt.some((s) => s.depositoId !== nexa.id)) console.log("   Atención: hay saldos de producto fuera del depósito NEXA; también se llevan a 0.");
  if (conteo.coloresDeCliente) {
    console.log(`\n   ${conteo.coloresDeCliente} colores especiales están asociados a un cliente: quedan sin cliente (el color y sus productos no se tocan).`);
  }
  console.log(`\n4) Numeración: ${reiniciar ? "los próximos pedidos, clientes, reclamos y despachos empiezan en 1" : "sigue desde el último número (agregar --reiniciar-numeracion para volver a 1)"}.`);

  if (!ejecutar) {
    console.log(`\nSimulación terminada. Para aplicar: agregar --ejecutar --confirmar=${fraseEsperada}\n`);
    await sqlc.end();
    return;
  }

  const [sistema] = await db.select({ id: schema.usuario.id }).from(schema.usuario).where(eq(schema.usuario.nombre, "Importación (sistema)")).orderBy(asc(schema.usuario.id)).limit(1);
  if (!sistema) throw new Error('Falta el usuario técnico "Importación (sistema)".');
  await db.transaction(async (tx) => {
    // Orden: de las hojas a la raíz (las claves foráneas no borran en cascada).
    for (const sentencia of [
      sql`delete from aviso where ${sql.raw(AVISO_VINCULADO)}`,
      sql`delete from reclamo_evento`,
      sql`delete from reclamo`,
      sql`delete from piqueo`,
      sql`delete from despacho_linea`,
      sql`delete from despacho`,
      sql`delete from reserva`,
      sql`delete from tanda_pedido`,
      sql`delete from ciclo_pedido`,
      sql`delete from pedido_linea`,
      sql`delete from pedido`,
      sql`update color set cliente_id = null where cliente_id is not null`,
      sql`delete from cliente`,
      sql`update caja set estado = 'BAJA' where estado <> 'BAJA'`,
    ]) {
      await tx.execute(sentencia);
    }
    for (const s of saldosPt) {
      await tx.insert(schema.movimiento).values({
        tipo: "AJUSTE",
        depositoId: s.depositoId,
        productoId: s.productoId,
        cantidad: String(-Number(s.cantidad)),
        origen: "INVENTARIO",
        motivo: MOTIVO,
        usuarioId: sistema.id,
      });
      await tx.update(schema.saldo).set({ cantidad: "0" }).where(eq(schema.saldo.id, s.id));
    }
    await tx.insert(schema.auditoriaConfig).values(
      [
        ["pedido", conteo.pedidos],
        ["cliente", conteo.clientes],
        ["reclamo", conteo.reclamos],
        ["stock producto terminado (unidades)", unidades],
      ].map(([entidad, n]) => ({ entidad: String(entidad), entidadId: "todos", campo: "puesta a cero", valorAnterior: String(n), valorNuevo: "0", motivo: MOTIVO, usuarioId: sistema.id })),
    );
    if (reiniciar) {
      for (const t of ["pedido", "pedido_linea", "despacho", "despacho_linea", "piqueo", "reserva", "reclamo", "reclamo_evento", "cliente"]) {
        await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('${t}', 'id'), 1, false)`));
      }
    }
  });
  console.log(`\nListo. Respaldo en ${dir}/. Verificar con: npx tsx scripts/verificar-saldos.ts\n`);
  await sqlc.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await sqlc.end();
  process.exit(1);
});
