/**
 * Conciliación de la planilla «stock MP Nexa 20-10-2026» (hoja STOCK,
 * extraída a data/stock-mp-2026-10-20.csv) contra el sistema. SÓLO LEE.
 *
 * La planilla tiene hojas auxiliares y gráficos viejos y su «Stock al
 * 20/10/2026» es un saldo teórico sin conteo físico (la columna «Físico al»
 * está vacía): no se importa masivamente. Este script muestra, material por
 * material, la diferencia contra el saldo del sistema y genera un archivo de
 * conteo listo para la puesta en marcha (scripts/puesta-en-marcha.ts
 * --conteo=...), que recién se aplica con autorización explícita y una fecha
 * de corte acordada.
 *
 * Uso: npx tsx scripts/conciliar-stock-mp.ts [--salida=respaldos/conteo-mp-2026-10-20.csv]
 */
if (!process.env.DATABASE_URL_UNPOOLED) {
  process.loadEnvFile(".env.local");
}

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";

/** Mismo criterio que el lector de códigos: «031» = «31», «B24» = «24», «B01» = «B1». */
function variantes(codigo: string): string[] {
  const c = codigo.trim().toUpperCase().replace(/-+$/, "");
  const m = /^([A-Z]?)0*(\d+)$/.exec(c);
  if (!m) return [c];
  const [, letra, n] = m;
  return [...new Set([c, `${letra}${n}`, letra ? n : c])];
}

const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/\./g, "").replace(",", ".")));

async function main() {
  const salidaArg = process.argv.find((a) => a.startsWith("--salida="))?.split("=")[1];
  const filas = readFileSync("data/stock-mp-2026-10-20.csv", "utf8").trim().split(/\r?\n/).slice(1).map((l) => l.split(";"));
  const client = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1 });
  const db = drizzle(client, { schema });
  const { materiaPrima, saldo, deposito } = schema;
  const mps = await db.select().from(materiaPrima);
  const deps = await db.select().from(deposito);
  const nexa = deps.find((d) => d.nombre === "NEXA")!;
  const pie = deps.find((d) => d.nombre === "Pie de máquina");
  const saldos = await db.select().from(saldo).where(and(inArray(saldo.depositoId, [nexa.id, ...(pie ? [pie.id] : [])])));
  const saldoDe = (id: number, dep: number) => Number(saldos.find((s) => s.materiaPrimaId === id && s.depositoId === dep)?.cantidad ?? 0);

  const conteo: string[] = ["tipo;codigo;cantidad"];
  const lineas: string[] = [];
  const sinMatch: string[] = [];
  let difs = 0;
  for (const [codigo, nombre, seccion, stock, minimo, maximo] of filas) {
    const v = variantes(codigo);
    const mp = v.map((x) => mps.find((m) => m.codigoInterno.toUpperCase() === x)).find(Boolean);
    const excel = num(stock);
    if (!mp) {
      sinMatch.push(`${codigo} · ${nombre} (${seccion}) · ${excel ?? "—"} kg`);
      continue;
    }
    const sis = saldoDe(mp.id, nexa.id);
    const enPie = pie ? saldoDe(mp.id, pie.id) : 0;
    const dif = excel == null ? null : Math.round((excel - sis) * 1000) / 1000;
    if (dif) difs++;
    const minMax = `${minimo || "—"}/${maximo || "—"} vs ${mp.minimo ?? "—"}/${mp.maximo ?? "—"}`;
    const maxMenorQueMin = num(minimo) != null && num(maximo) != null && num(maximo)! < num(minimo)!;
    lineas.push(`${codigo.padEnd(4)} → ${mp.codigoInterno.padEnd(4)} ${mp.nombre.slice(0, 38).padEnd(38)} Excel ${String(excel ?? "—").padStart(9)} · sistema ${String(sis).padStart(9)} (+ pie ${enPie}) · dif ${dif ?? "—"} · mín/máx ${minMax}${maxMenorQueMin ? " · ¡máximo menor que mínimo en el Excel!" : ""}`);
    if (excel != null) conteo.push(`mp;${mp.codigoInterno};${String(excel).replace(".", ",")}`);
  }
  console.log("Conciliación hoja STOCK (Excel 20/10/2026) vs. stock general del sistema\n");
  console.log(lineas.join("\n"));
  console.log(`\n${difs} materiales con diferencia.`);
  if (sinMatch.length) console.log(`\nEn el Excel pero no en el sistema (no se crean solos; es un cambio estructural):\n- ${sinMatch.join("\n- ")}`);
  const enSistemaNoExcel = mps.filter((m) => !filas.some(([c]) => variantes(c).includes(m.codigoInterno.toUpperCase())));
  if (enSistemaNoExcel.length) console.log(`\nEn el sistema pero no en la hoja STOCK:\n- ${enSistemaNoExcel.map((m) => `${m.codigoInterno} · ${m.nombre}`).join("\n- ")}`);
  if (salidaArg) {
    mkdirSync(path.dirname(salidaArg), { recursive: true });
    writeFileSync(salidaArg, conteo.join("\n") + "\n");
    console.log(`\nArchivo de conteo para la puesta en marcha: ${salidaArg} (no se aplicó nada).`);
  }
  await client.end();
  void eq;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
