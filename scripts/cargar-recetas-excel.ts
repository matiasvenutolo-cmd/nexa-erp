/**
 * Recetas de carga según el Excel «master y tiempos» de Eduardo (13/11/2026,
 * resumido en «Reunión 10/11: cambios y pendientes»). Lo que contradiga datos
 * anteriores se toma del Excel (decisión del 14/11).
 *
 *   Piso rejilla       25 kg Copolímero 2240 P · master 0,375 kg (negro 0,3 kg;
 *                      en el arranque el negro suma 0,375 kg)
 *   Rampa / esquinero  10 kg Copolímero 2240 P · master 0,15 kg
 *   rejilla
 *   Piso ciego         25 kg 2240 P + 25 kg Plastomer · master 0,9 kg (en el
 *   (trama y moneda)   arranque el negro suma 0,75 kg)
 *   Rampa / esquinero  10 kg 2240 P + 25 kg Plastomer · master 0,15 kg
 *   ciego
 *
 * No se cargan los colores cuyo master falta confirmar (los dos azules, los
 * dos verdes y Violeta Obispo): su receta queda como está.
 *
 * Uso:
 *   npx tsx scripts/cargar-recetas-excel.ts            # simula
 *   npx tsx scripts/cargar-recetas-excel.ts --aplicar  # escribe (auditado)
 */
if (!process.env.DATABASE_URL_UNPOOLED) process.loadEnvFile(".env.local");

const APLICAR = process.argv.includes("--aplicar");
const MOTIVO = "Recetas del Excel «master y tiempos» de Eduardo (reunión 10/11/2026)";
const COLORES_A_CONFIRMAR = ["Azul Claro", "Azul Oscuro", "Verde Claro", "Verde Oscuro", "Violeta Obispo"];

type Base = { codigo: string; presentacion: string; cantidad: number };
type Regla = { base: Base[]; masterKg: (negro: boolean) => number; arranqueExtraKg?: (negro: boolean) => number | null };
const BOLSA: Base = { codigo: "31", presentacion: "Bolsa 25 kg", cantidad: 1 };
const DIEZ: Base = { codigo: "31", presentacion: "Medida 10 kg", cantidad: 1 };
const PLASTOMER: Base = { codigo: "19", presentacion: "Bolsa 25 kg", cantidad: 1 };
const REGLAS: Record<string, Regla> = {
  "REJILLA|UNICO": { base: [BOLSA], masterKg: (n) => (n ? 0.3 : 0.375), arranqueExtraKg: (n) => (n ? 0.375 : null) },
  "REJILLA|RAMPA": { base: [DIEZ], masterKg: () => 0.15 },
  "REJILLA|ESQUINERO": { base: [DIEZ], masterKg: () => 0.15 },
  "CIEGO|TRAMA": { base: [BOLSA, PLASTOMER], masterKg: () => 0.9, arranqueExtraKg: (n) => (n ? 0.75 : null) },
  "CIEGO|MONEDA": { base: [BOLSA, PLASTOMER], masterKg: () => 0.9, arranqueExtraKg: (n) => (n ? 0.75 : null) },
  "CIEGO|RAMPA": { base: [DIEZ, PLASTOMER], masterKg: () => 0.15 },
  "CIEGO|ESQUINERO": { base: [DIEZ, PLASTOMER], masterKg: () => 0.15 },
};
/** Presentaciones que hacen falta (se crean si no están). */
const PRESENTACIONES = [
  { nombre: "Medida 10 kg", kg: 10, tipoMp: "VIRGEN" as const },
  { nombre: "Bolsita 150 g", kg: 0.15, tipoMp: "MASTER" as const },
  { nombre: "Bolsita 300 g", kg: 0.3, tipoMp: "MASTER" as const },
  { nombre: "Bolsita 375 g", kg: 0.375, tipoMp: "MASTER" as const },
  { nombre: "Bolsita 750 g", kg: 0.75, tipoMp: "MASTER" as const },
  { nombre: "Bolsita 900 g", kg: 0.9, tipoMp: "MASTER" as const },
];
const bolsitaDe = (kg: number) => `Bolsita ${Math.round(kg * 1000)} g`;

async function main() {
  const { db } = await import("../src/lib/db/client");
  const schema = await import("../src/lib/db/schema");
  const { crearPresentacion, guardarReceta, recetasDe } = await import("../src/lib/data/recetas");
  const { and, eq, inArray, isNull } = await import("drizzle-orm");
  const [sistema] = await db.select({ id: schema.usuario.id }).from(schema.usuario).where(eq(schema.usuario.nombre, "Importación (sistema)")).orderBy(schema.usuario.id).limit(1);
  const actor = { id: sistema.id, rol: "GERENCIA" as const };

  // Presentaciones.
  const existentes = await db.select().from(schema.presentacionMp);
  for (const p of PRESENTACIONES) {
    if (existentes.some((e) => e.nombre === p.nombre && e.tipoMp === p.tipoMp)) continue;
    console.log(`+ presentación ${p.nombre} (${p.tipoMp})`);
    if (APLICAR) {
      const r = await crearPresentacion(actor, p);
      if (r.error) throw new Error(r.error);
    }
  }
  const pres = await db.select().from(schema.presentacionMp);
  const presId = (nombre: string, tipo: "VIRGEN" | "MASTER") => pres.find((p) => p.nombre === nombre && p.tipoMp === tipo)?.id ?? -1;
  const mps = await db.select({ id: schema.materiaPrima.id, codigo: schema.materiaPrima.codigoInterno }).from(schema.materiaPrima).where(inArray(schema.materiaPrima.codigoInterno, ["31", "19"]));
  const mpId = (codigo: string) => mps.find((m) => m.codigo === codigo)!.id;

  const productos = await db
    .select({ id: schema.producto.id, codigo: schema.producto.codigo, familia: schema.producto.familia, tipo: schema.producto.tipo, color: schema.color.nombre, masterId: schema.color.masterMateriaPrimaId })
    .from(schema.producto)
    .innerJoin(schema.color, eq(schema.producto.colorId, schema.color.id))
    .where(and(eq(schema.producto.activo, true)));
  const actuales = await recetasDe(productos.map((p) => p.id));
  let cambios = 0;
  const salteados: string[] = [];
  for (const p of productos.sort((a, b) => a.codigo.localeCompare(b.codigo))) {
    const regla = REGLAS[`${p.familia}|${p.tipo}`];
    if (!regla) continue;
    if (COLORES_A_CONFIRMAR.includes(p.color) || !p.masterId) {
      salteados.push(`${p.codigo} (${p.color})`);
      continue;
    }
    const negro = p.color === "Negro";
    const items = [
      ...regla.base.map((b) => ({ materiaPrimaId: mpId(b.codigo), presentacionId: presId(b.presentacion, "VIRGEN"), cantidad: b.cantidad })),
      { materiaPrimaId: p.masterId, presentacionId: presId(bolsitaDe(regla.masterKg(negro)), "MASTER"), cantidad: 1 },
    ];
    const extra = regla.arranqueExtraKg?.(negro) ?? null;
    const arranque = extra ? [...items, { materiaPrimaId: p.masterId, presentacionId: presId(bolsitaDe(extra), "MASTER"), cantidad: 1 }] : null;
    for (const [tipo, nuevos] of [["REGIMEN", items], ["ARRANQUE", arranque]] as const) {
      if (!nuevos) continue;
      const firma = (xs: { materiaPrimaId: number; presentacionId: number; cantidad: number }[]) => xs.map((x) => `${x.materiaPrimaId}:${x.presentacionId}:${Number(x.cantidad)}`).sort().join("|");
      const actual = actuales.get(p.id)?.[tipo];
      if (actual && firma(actual.items) === firma(nuevos)) continue;
      cambios++;
      console.log(`${actual ? "~" : "+"} ${p.codigo} ${tipo === "REGIMEN" ? "normal" : "arranque"}${actual ? ` (antes: ${actual.items.map((i) => `${i.texto} ${i.materiaPrimaNombre}`).join(" + ")})` : ""}`);
      if (APLICAR) {
        const r = await guardarReceta(actor, p.id, tipo, { items: nuevos, motivo: MOTIVO });
        if (r.error) throw new Error(`${p.codigo}: ${r.error}`);
      }
    }
  }
  // Regla general del ciego: 0,9 kg de master cada 25 kg de 2240 P + 25 kg de
  // Plastomer = 18 g por kg de mezcla, mitad y mitad.
  const { actualizarDosificacion } = await import("../src/lib/data/dosificacion");
  const [ciego] = await db.select().from(schema.dosificacionMaster).where(and(eq(schema.dosificacionMaster.familia, "CIEGO"), isNull(schema.dosificacionMaster.colorId)));
  const nueva = { gPorKgMp: 18, kgReferencia: 1, materiaPrimaBaseId: mpId("31"), materiaPrimaBase2Id: mpId("19"), proporcionBase1: 0.5 };
  if (
    ciego &&
    (Number(ciego.gPorKgMp) !== nueva.gPorKgMp || Number(ciego.kgReferencia) !== nueva.kgReferencia || ciego.materiaPrimaBaseId !== nueva.materiaPrimaBaseId || ciego.materiaPrimaBase2Id !== nueva.materiaPrimaBase2Id || Number(ciego.proporcionBase1) !== nueva.proporcionBase1)
  ) {
    cambios++;
    console.log(`~ dosificación del ciego: ${Number(ciego.gPorKgMp)} g/kg → 18 g/kg (2240 P + Plastomer, mitad y mitad)`);
    if (APLICAR) {
      const r = await actualizarDosificacion(actor, ciego.id, { ...nueva, observaciones: "0,9 kg de master cada 25 kg de 2240 P + 25 kg de Plastomer (Excel de Eduardo, 13/11)", motivo: MOTIVO });
      if (r.error) throw new Error(`Dosificación del ciego: ${r.error}`);
    }
  }
  console.log(`\n${cambios} recetas ${APLICAR ? "guardadas" : "a guardar"}. Sin tocar (master a confirmar): ${salteados.length} productos.`);
  if (!APLICAR) console.log("Simulación: no se escribió nada. Para aplicar: --aplicar");
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
