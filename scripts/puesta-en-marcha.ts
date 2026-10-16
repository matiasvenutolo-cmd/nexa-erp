/**
 * Puesta en marcha con arranque limpio (minuta 15/10/2026): "cuando el sistema
 * esté aprobado, arrancar de cero (idealmente un lunes) con stock de materia
 * prima, stock de producto y pedidos vigentes; sin históricos".
 *
 * SEGURO POR DISEÑO — no borra nada:
 *  1. Respaldo: exporta TODAS las tablas a respaldos/<fecha>/*.json antes de
 *     cualquier cambio (carpeta fuera del control de versiones).
 *  2. Simulación (por defecto): muestra qué pedidos se archivarían y, si se
 *     pasa un conteo físico, la diferencia contra el sistema de cada material
 *     y producto. No escribe nada.
 *  3. Ejecución: sólo con --ejecutar y --confirmar=ARRANQUE-<fecha de corte>.
 *     - Archiva (reversible) los pedidos que no siguen vigentes: los cerrados
 *       (entregados o cancelados) anteriores a la fecha de corte y los
 *       históricos sin producto asignado. Los históricos quedan para la
 *       trazabilidad, sólo dejan de verse en las vistas operativas.
 *     - Con --conteo=archivo.csv, registra un ajuste de INVENTARIO por cada
 *       diferencia (depósito), con motivo y usuario: el saldo queda igual al
 *       conteo físico y el ledger explica la diferencia.
 *
 * Conteo (CSV, separador ; o ,): tipo;codigo;cantidad
 *   mp;31;2800,95        (kg, coma o punto decimal; 1.500 = mil quinientos)
 *   producto;001B-PR-NE;1250
 *
 * Uso:
 *   npx tsx scripts/puesta-en-marcha.ts --corte=2026-11-02 [--conteo=conteo.csv]
 *   npx tsx scripts/puesta-en-marcha.ts --corte=2026-11-02 --conteo=conteo.csv --ejecutar --confirmar=ARRANQUE-2026-11-02
 */
if (!process.env.DATABASE_URL_UNPOOLED) {
  process.loadEnvFile(".env.local");
}

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";
import { parseCantidadAR } from "../src/lib/presentaciones";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "1"];
  }),
);
const corte = String(args.corte ?? "");
if (!/^\d{4}-\d{2}-\d{2}$/.test(corte)) {
  console.error("Indicá la fecha de corte: --corte=AAAA-MM-DD (idealmente un lunes).");
  process.exit(1);
}
const ejecutar = args.ejecutar === "1";
const fraseEsperada = `ARRANQUE-${corte}`;
if (ejecutar && args.confirmar !== fraseEsperada) {
  console.error(`Para ejecutar hace falta --confirmar=${fraseEsperada} (confirmación explícita).`);
  process.exit(1);
}

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

function leerConteo(archivo: string) {
  const lineas = readFileSync(archivo, "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const res: { tipo: "mp" | "producto"; codigo: string; cantidad: number; linea: number }[] = [];
  lineas.forEach((l, i) => {
    const [tipo, codigo, cant] = l.split(/[;\t]/).length >= 3 ? l.split(/[;\t]/) : l.split(",");
    if (i === 0 && /tipo/i.test(tipo)) return;
    const cantidad = parseCantidadAR(String(cant ?? ""));
    if ((tipo !== "mp" && tipo !== "producto") || !codigo || cantidad == null) {
      throw new Error(`Conteo, línea ${i + 1}: «${l}» no se entiende (tipo;codigo;cantidad).`);
    }
    res.push({ tipo, codigo: codigo.trim(), cantidad, linea: i + 1 });
  });
  return res;
}

async function main() {
  console.log(`\nPuesta en marcha · fecha de corte ${corte} · ${ejecutar ? "EJECUCIÓN" : "SIMULACIÓN (no se escribe nada)"}\n`);
  const dir = await respaldar();
  console.log(`1) Respaldo completo en ${dir}/ (una planilla JSON por tabla).`);

  // Pedidos que dejan de verse en las vistas operativas.
  const candidatos = await db
    .select({ id: schema.pedido.id, estado: schema.pedido.estado, fecha: schema.pedido.fechaPedido })
    .from(schema.pedido)
    .where(
      and(
        eq(schema.pedido.archivado, false),
        or(
          and(inArray(schema.pedido.estado, ["ENTREGADO", "CANCELADO"]), lt(schema.pedido.fechaPedido, corte)),
          sql`not exists (select 1 from pedido_linea pl where pl.pedido_id = ${schema.pedido.id} and pl.producto_id is not null)`,
        ),
      ),
    );
  console.log(`\n2) Pedidos a archivar (reversible): ${candidatos.length}`);
  const porEstado = candidatos.reduce<Record<string, number>>((t, c) => ((t[c.estado] = (t[c.estado] ?? 0) + 1), t), {});
  for (const [e, n] of Object.entries(porEstado)) console.log(`   · ${e}: ${n}`);
  const abiertosSinProducto = candidatos.filter((c) => c.estado !== "ENTREGADO" && c.estado !== "CANCELADO");
  if (abiertosSinProducto.length) {
    console.log(`   Atención: ${abiertosSinProducto.length} están abiertos y sin producto asignado (#${abiertosSinProducto.map((c) => c.id).join(", #")}). Confirmar con Ventas que no siguen vigentes.`);
  }

  // Conteo físico.
  const [deposito] = await db.select().from(schema.deposito).where(eq(schema.deposito.nombre, "NEXA"));
  const ajustes: { tipo: "mp" | "producto"; id: number; nombre: string; sistema: number; conteo: number }[] = [];
  if (args.conteo) {
    const conteo = leerConteo(String(args.conteo));
    for (const c of conteo) {
      if (c.tipo === "mp") {
        const [mp] = await db.select().from(schema.materiaPrima).where(sql`lower(${schema.materiaPrima.codigoInterno}) = lower(${c.codigo})`);
        if (!mp) throw new Error(`Conteo, línea ${c.linea}: no existe el material ${c.codigo}.`);
        const [s] = await db.select().from(schema.saldo).where(and(eq(schema.saldo.depositoId, deposito.id), eq(schema.saldo.materiaPrimaId, mp.id)));
        ajustes.push({ tipo: "mp", id: mp.id, nombre: mp.nombre, sistema: Number(s?.cantidad ?? 0), conteo: c.cantidad });
      } else {
        const [p] = await db.select().from(schema.producto).where(eq(schema.producto.codigo, c.codigo));
        if (!p) throw new Error(`Conteo, línea ${c.linea}: no existe el producto ${c.codigo}.`);
        const [s] = await db.select().from(schema.saldo).where(and(eq(schema.saldo.depositoId, deposito.id), eq(schema.saldo.productoId, p.id)));
        ajustes.push({ tipo: "producto", id: p.id, nombre: p.codigo, sistema: Number(s?.cantidad ?? 0), conteo: c.cantidad });
      }
    }
    const conDif = ajustes.filter((a) => Math.abs(a.conteo - a.sistema) > 0.0005);
    console.log(`\n3) Conteo físico: ${ajustes.length} ítems, ${conDif.length} con diferencia contra el sistema:`);
    for (const a of conDif) console.log(`   · ${a.tipo === "mp" ? "MP" : "Producto"} ${a.nombre}: sistema ${a.sistema} → conteo ${a.conteo} (ajuste ${a.conteo - a.sistema > 0 ? "+" : ""}${Math.round((a.conteo - a.sistema) * 1000) / 1000})`);
  } else {
    console.log("\n3) Sin conteo físico (--conteo=archivo.csv): no se proponen ajustes de saldo.");
  }

  // Pie de máquina y tolva tienen que estar en cero al arrancar.
  const enCircuito = await db
    .select({ dep: schema.deposito.nombre, n: sql<number>`count(*)`.mapWith(Number) })
    .from(schema.saldo)
    .innerJoin(schema.deposito, eq(schema.saldo.depositoId, schema.deposito.id))
    .where(and(inArray(schema.deposito.nombre, ["Pie de máquina", "Tolva / en proceso"]), sql`${schema.saldo.cantidad} <> 0`))
    .groupBy(schema.deposito.nombre);
  const abiertos = await db.select({ id: schema.cicloProduccion.id }).from(schema.cicloProduccion).where(isNull(schema.cicloProduccion.fechaFin));
  console.log(`\n4) Controles previos: ${abiertos.length} producciones abiertas; material en pie de máquina o tolva: ${enCircuito.map((e) => `${e.dep} (${e.n})`).join(", ") || "ninguno"}.`);
  if (abiertos.length || enCircuito.length) console.log("   Conviene cerrar producciones y conciliar retiros antes del arranque.");

  if (!ejecutar) {
    console.log(`\nSimulación terminada. Para aplicar: agregar --ejecutar --confirmar=${fraseEsperada}\n`);
    await sqlc.end();
    return;
  }

  const [sistema] = await db.select().from(schema.usuario).where(eq(schema.usuario.nombre, "Importación (sistema)")).limit(1);
  if (!sistema) throw new Error('Falta el usuario técnico "Importación (sistema)".');
  await db.transaction(async (tx) => {
    if (candidatos.length) {
      await tx
        .update(schema.pedido)
        .set({ archivado: true, archivadoMotivo: `Arranque limpio ${corte}`, archivadoEn: new Date(), archivadoPorId: sistema.id })
        .where(inArray(schema.pedido.id, candidatos.map((c) => c.id)));
      await tx.insert(schema.auditoriaConfig).values(
        candidatos.map((c) => ({ entidad: "pedido", entidadId: String(c.id), campo: "archivado", valorAnterior: "no", valorNuevo: "sí", motivo: `Arranque limpio ${corte}`, usuarioId: sistema.id })),
      );
    }
    for (const a of ajustes) {
      const delta = Math.round((a.conteo - a.sistema) * 1000) / 1000;
      if (delta === 0) continue;
      await tx.insert(schema.movimiento).values({
        tipo: "AJUSTE",
        depositoId: deposito.id,
        ...(a.tipo === "mp" ? { materiaPrimaId: a.id } : { productoId: a.id }),
        cantidad: String(delta),
        origen: "INVENTARIO",
        motivo: `Conteo físico del arranque ${corte}`,
        usuarioId: sistema.id,
      });
      const cond = a.tipo === "mp" ? eq(schema.saldo.materiaPrimaId, a.id) : eq(schema.saldo.productoId, a.id);
      const [s] = await tx.select().from(schema.saldo).where(and(eq(schema.saldo.depositoId, deposito.id), cond));
      if (s) await tx.update(schema.saldo).set({ cantidad: String(a.conteo) }).where(eq(schema.saldo.id, s.id));
      else await tx.insert(schema.saldo).values({ depositoId: deposito.id, ...(a.tipo === "mp" ? { materiaPrimaId: a.id } : { productoId: a.id }), cantidad: String(a.conteo) });
    }
  });
  console.log(`\nListo: ${candidatos.length} pedidos archivados y ${ajustes.filter((a) => a.conteo !== a.sistema).length} ajustes de inventario registrados. Respaldo en ${dir}/.\n`);
  await sqlc.end();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await sqlc.end();
  process.exit(1);
});
