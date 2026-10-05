/**
 * Carga inicial de configuración desde data/codigos.xlsx (lista que mandó el
 * cliente con "Definiciones pendientes") + los valores de master de la
 * respuesta 2 del mismo documento.
 *
 * NO DESTRUCTIVO E IDEMPOTENTE:
 *  - no crea ni borra productos, colores ni materias primas; no toca stock;
 *  - cada valor que cambia queda en auditoria_config (usuario "Importación
 *    (sistema)"), con el valor anterior;
 *  - correrlo dos veces no cambia nada la segunda vez;
 *  - en la ficha de cada color sólo completa campos vacíos: nunca pisa lo que
 *    alguien ya editó desde el Panel Admin;
 *  - ante datos contradictorios dentro del propio Excel, no elige: deja el
 *    campo como está y lo reporta.
 *
 * Emite docs/migracion-configuracion.md con todo lo aplicado y lo observado.
 *
 * Uso: npx tsx scripts/cargar-configuracion.ts [--dry-run]
 */
if (!process.env.DATABASE_URL_UNPOOLED) {
  process.loadEnvFile(".env.local");
}

import { writeFileSync } from "node:fs";
import path from "node:path";
import { and, asc, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as XLSX from "xlsx";
import * as schema from "../src/lib/db/schema";

const DRY_RUN = process.argv.includes("--dry-run");
const ARCHIVO = path.resolve("data/codigos.xlsx");
const MOTIVO = "Carga inicial desde codigos.xlsx (Definiciones pendientes)";

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Falta DATABASE_URL_UNPOOLED en .env.local");
const client = postgres(url, { prepare: false });
const db = drizzle(client, { schema });
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const reporte = {
  aplicado: [] as string[],
  sinCambios: 0,
  observaciones: [] as string[],
};

type Celda = string | number | null | undefined;

const txt = (v: Celda) => (v == null ? "" : String(v).trim());
const normal = (v: Celda) => txt(v).toUpperCase().replace(/\s+/g, " ");

/**
 * Filas de una hoja como objetos por nombre de columna. Las hojas del cliente
 * tienen espacios al final del nombre y no empiezan en la columna A, así que
 * se busca la fila de encabezados por su contenido, no por posición.
 */
function hoja(nombre: string, columnas: Record<string, string>): Record<string, Celda>[] {
  const wb = XLSX.readFile(ARCHIVO);
  const real = wb.SheetNames.find((n) => normal(n) === normal(nombre));
  if (!real) throw new Error(`Falta la hoja "${nombre}" en ${ARCHIVO}`);
  const filas = XLSX.utils.sheet_to_json<Celda[]>(wb.Sheets[real], { header: 1, defval: null, raw: true });
  const buscadas = Object.values(columnas).map(normal);
  const filaEncabezado = filas.findIndex((f) => buscadas.every((b) => f.some((c) => normal(c) === b)));
  if (filaEncabezado < 0) throw new Error(`Hoja "${nombre}": no se encontraron las columnas ${buscadas.join(", ")}`);
  const encabezado = filas[filaEncabezado].map(normal);
  // Si un encabezado se repite (la hoja de MP repite la fila de títulos por
  // sección), se toma la primera aparición de cada columna.
  const indice = Object.fromEntries(Object.entries(columnas).map(([clave, col]) => [clave, encabezado.indexOf(normal(col))]));
  return filas.slice(filaEncabezado + 1).map((f) => Object.fromEntries(Object.entries(indice).map(([k, i]) => [k, f[i]])));
}
const num = (v: Celda): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** "04" → "4", "p10" → "P10", "24B-Master..." → "24". */
function codigoMp(texto: string): string | null {
  const m = texto.trim().match(/^([A-Za-z]?)0*(\d+)/);
  return m ? `${m[1].toUpperCase()}${m[2]}` : null;
}

async function auditar(tx: Tx, usuarioId: number, entidad: string, entidadId: number | string, campo: string, anterior: unknown, nuevo: unknown, motivo = MOTIVO) {
  await tx.insert(schema.auditoriaConfig).values({
    entidad,
    entidadId: String(entidadId),
    campo,
    valorAnterior: anterior == null ? null : String(anterior),
    valorNuevo: nuevo == null ? null : String(nuevo),
    motivo,
    usuarioId,
  });
}

const igual = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && Number(a) === Number(b));

async function main() {
  const [sistema] = await db
    .select({ id: schema.usuario.id })
    .from(schema.usuario)
    .where(eq(schema.usuario.nombre, "Importación (sistema)"))
    .orderBy(asc(schema.usuario.id))
    .limit(1);
  if (!sistema) throw new Error('Falta el usuario "Importación (sistema)" — correr primero npm run db:import-excel');

  const productos = await db.select().from(schema.producto);
  const porNumero = new Map(productos.map((p) => [p.numero, p]));
  const colores = await db.select().from(schema.color);
  const materias = await db.select().from(schema.materiaPrima);
  const mpPorCodigo = new Map(materias.map((m) => [codigoMp(m.codigoInterno) ?? m.codigoInterno, m]));
  const proveedores = await db.select().from(schema.proveedorMaster);

  // -------------------------------------------------------------------------
  // 1. Mínimos, máximos y código de barras de pisos y accesorios
  // -------------------------------------------------------------------------
  const pisos = hoja("minimos en pisos", {
    numero: "NUMERO",
    codigo: "CODIGO DE BARRAS",
    articulo: "ARTICULO",
    maximo: "MAXIMO",
    minimo: "MINIMO",
  }).filter((r) => /^\d{3}/.test(txt(r.codigo)));
  const filasColores = hoja("colores", {
    codigo: "Codigo de barras",
    articulo: "Articulo",
    proveedor: "Proveedor",
    master: "Codigo",
  }).filter((r) => /^\d{3}/.test(txt(r.codigo)));
  const codigosHojaColores = new Map(filasColores.map((r) => [txt(r.codigo).slice(0, 3), txt(r.codigo)]));

  await db.transaction(async (tx) => {
    for (const r of pisos) {
      const crudo = txt(r.codigo);
      const numero = crudo.slice(0, 3);
      const columnaNumero = txt(r.numero);
      const p = porNumero.get(numero);
      if (!p) {
        reporte.observaciones.push(`Producto ${crudo} (“${txt(r.articulo)}”) no existe en el catálogo del sistema — no se crea.`);
        continue;
      }
      if (columnaNumero && !columnaNumero.startsWith(numero)) {
        reporte.observaciones.push(`Fila ${crudo}: la columna NUMERO dice “${columnaNumero}” y el código de barras empieza con ${numero}. Se tomó el número del código de barras (coincide con el artículo).`);
      }

      const maximo = num(r.maximo);
      const minimo = num(r.minimo);
      if (minimo != null && maximo != null && maximo > 0 && maximo < minimo) {
        reporte.observaciones.push(`${crudo}: máximo ${maximo} menor que mínimo ${minimo} — no se cargó, revisar.`);
      } else {
        const cambios: Partial<typeof schema.producto.$inferInsert> = {};
        if (minimo != null && !igual(p.minimo, minimo)) cambios.minimo = minimo;
        if (maximo != null && !igual(p.maximo, maximo)) cambios.maximo = maximo;
        if (Object.keys(cambios).length > 0) {
          await tx.update(schema.producto).set(cambios).where(eq(schema.producto.id, p.id));
          if ("minimo" in cambios) await auditar(tx, sistema.id, "producto", p.id, "minimo", p.minimo, cambios.minimo);
          if ("maximo" in cambios) await auditar(tx, sistema.id, "producto", p.id, "maximo", p.maximo, cambios.maximo);
          reporte.aplicado.push(`${p.codigo}: mínimo ${p.minimo ?? "—"} → ${minimo ?? p.minimo}, máximo ${p.maximo ?? "—"} → ${maximo ?? p.maximo}`);
        } else {
          reporte.sinCambios++;
        }
        if (minimo != null && maximo != null && minimo === maximo) {
          reporte.observaciones.push(`${crudo}: mínimo y máximo iguales (${minimo}). Se cargó tal cual.`);
        }
      }

      // Código de barras: sin espacios internos ("033B- CM-GO" no se puede leer con un lector).
      const limpio = crudo.replace(/\s+/g, "");
      if (limpio !== crudo) reporte.observaciones.push(`Código de barras “${crudo}” tenía espacios: se guardó como ${limpio}.`);
      const enHojaColores = codigosHojaColores.get(numero);
      if (enHojaColores && enHojaColores.replace(/\s+/g, "") !== limpio) {
        reporte.observaciones.push(`Producto ${numero}: la hoja “colores” dice ${enHojaColores} y la hoja “minimos en pisos” dice ${limpio}. No se eligió: el código de barras queda sin cargar hasta que confirmen.`);
        continue;
      }
      if (p.codigoBarras !== limpio) {
        await tx.update(schema.producto).set({ codigoBarras: limpio }).where(eq(schema.producto.id, p.id));
        await auditar(tx, sistema.id, "producto", p.id, "codigo_barras", p.codigoBarras, limpio);
        reporte.aplicado.push(`${p.codigo}: código de barras ${limpio}`);
      }
    }
    const numerosExcel = new Set(pisos.map((r) => txt(r.codigo).slice(0, 3)));
    for (const p of productos.filter((x) => !numerosExcel.has(x.numero))) {
      reporte.observaciones.push(`${p.codigo} (${p.descripcion}) está en el sistema pero no en la hoja “minimos en pisos”: mínimo y máximo quedan como estaban.`);
    }
    if (DRY_RUN) throw new Error("dry-run");
  }).catch(silenciarDryRun);

  // -------------------------------------------------------------------------
  // 2. Mínimos y máximos de materia prima
  // -------------------------------------------------------------------------
  await db.transaction(async (tx) => {
    const filasMp = hoja("minimos Materia prima", { nombre: "MATERIAL VIRGEN", minimo: "STOCK MINIMO", maximo: "STOCK MAXIMO" });
    for (const r of filasMp) {
      const nombre = txt(r.nombre);
      // Saltea los títulos de sección ("Materiales de muestra...", "Sobrantes y moliendas").
      if (!nombre || !codigoMp(nombre)) continue;
      const minimo = num(r.minimo);
      const maximo = num(r.maximo);
      if (minimo == null && maximo == null) continue;
      const codigo = codigoMp(nombre);
      const mp = codigo ? mpPorCodigo.get(codigo) : undefined;
      if (!mp) {
        reporte.observaciones.push(`Materia prima “${nombre}” no existe en el sistema — no se crea.`);
        continue;
      }
      const cambios: { minimo?: string; maximo?: string } = {};
      if (minimo != null && !igual(mp.minimo, minimo)) cambios.minimo = String(minimo);
      if (maximo != null && !igual(mp.maximo, maximo)) cambios.maximo = String(maximo);
      if (Object.keys(cambios).length === 0) {
        reporte.sinCambios++;
        continue;
      }
      await tx.update(schema.materiaPrima).set(cambios).where(eq(schema.materiaPrima.id, mp.id));
      if (cambios.minimo) await auditar(tx, sistema.id, "materia_prima", mp.id, "minimo", mp.minimo, cambios.minimo);
      if (cambios.maximo) await auditar(tx, sistema.id, "materia_prima", mp.id, "maximo", mp.maximo, cambios.maximo);
      reporte.aplicado.push(`MP ${mp.nombre}: mínimo ${mp.minimo ?? "—"} → ${cambios.minimo ?? mp.minimo}, máximo ${mp.maximo ?? "—"} → ${cambios.maximo ?? mp.maximo}`);
      if (minimo === 0 && maximo === 0) {
        reporte.observaciones.push(`MP ${mp.nombre}: mínimo y máximo en 0 — el semáforo lo toma como “no controlado”.`);
      }
    }
    if (DRY_RUN) throw new Error("dry-run");
  }).catch(silenciarDryRun);

  // -------------------------------------------------------------------------
  // 3. Lista oficial de colores: proveedor y master de cada uno
  // -------------------------------------------------------------------------
  const oficiales = new Set<number>();
  await db.transaction(async (tx) => {
    for (const r of filasColores) {
      const numero = txt(r.codigo).slice(0, 3);
      const p = porNumero.get(numero);
      if (!p) {
        reporte.observaciones.push(`Hoja colores: ${txt(r.codigo)} no existe en el catálogo.`);
        continue;
      }
      const c = colores.find((x) => x.id === p.colorId)!;
      oficiales.add(c.id);
      const provTexto = txt(r.proveedor).toUpperCase();
      const proveedor = proveedores.find((x) => provTexto.startsWith(x.nombre.toUpperCase()));
      if (!proveedor) {
        reporte.observaciones.push(`Color ${c.nombre}: el proveedor de master figura como “${txt(r.proveedor)}”, que no es un proveedor conocido (Berma/Arcolor/Platsur). Queda sin proveedor en la ficha del color.`);
      } else if (provTexto !== proveedor.nombre.toUpperCase()) {
        reporte.observaciones.push(`Color ${c.nombre}: proveedor “${txt(r.proveedor)}” interpretado como ${proveedor.nombre}.`);
      }
      const masterTexto = txt(r.master).replace(/\s+/g, " ");
      const mpCodigo = codigoMp(masterTexto);
      const master = mpCodigo ? mpPorCodigo.get(mpCodigo) : undefined;
      if (masterTexto && !master) {
        reporte.observaciones.push(`Color ${c.nombre}: el master “${masterTexto}” no se encontró en materia prima.`);
      }

      const propuesta = {
        oficial: true,
        proveedorMasterId: proveedor?.id ?? null,
        masterNombre: masterTexto || null,
        masterMateriaPrimaId: master?.id ?? null,
      };
      const cambios: Partial<typeof schema.color.$inferInsert> = {};
      if (!c.oficial) cambios.oficial = true;
      for (const campo of ["proveedorMasterId", "masterNombre", "masterMateriaPrimaId"] as const) {
        const actual = c[campo];
        const nuevo = propuesta[campo];
        if (nuevo == null || actual === nuevo) continue;
        if (actual == null) (cambios as Record<string, unknown>)[campo] = nuevo;
        else reporte.observaciones.push(`Color ${c.nombre}: ${campo} ya tenía “${actual}” (editado en el sistema); el Excel dice “${nuevo}”. No se pisó.`);
      }
      if (Object.keys(cambios).length === 0) {
        reporte.sinCambios++;
        continue;
      }
      await tx.update(schema.color).set(cambios).where(eq(schema.color.id, c.id));
      for (const [campo, nuevo] of Object.entries(cambios)) {
        await auditar(tx, sistema.id, "color", c.id, campo, c[campo as keyof typeof c], nuevo);
      }
      reporte.aplicado.push(`Color ${c.nombre}: ${Object.keys(cambios).join(", ")}`);
    }
    if (DRY_RUN) throw new Error("dry-run");
  }).catch(silenciarDryRun);

  for (const c of colores.filter((x) => !oficiales.has(x.id) && !x.especial)) {
    reporte.observaciones.push(`Color “${c.nombre}” está en el sistema pero no en la lista oficial (hoja colores). Queda como “sin clasificar”: se puede marcar como especial desde Panel Admin → Colores.`);
  }
  reporte.observaciones.push(
    `La hoja “colores” trae ${filasColores.length} colores; el documento de definiciones habla de “la lista de 12 colores”.`,
  );

  // -------------------------------------------------------------------------
  // 4. Dosificación de master (Definiciones pendientes, respuesta 2)
  // -------------------------------------------------------------------------
  const negro = colores.find((c) => c.clave === "negro");
  const dosificaciones = [
    { familia: "REJILLA" as const, colorId: null, base: "31", valor: 0.015, nota: "Mayoría de los colores de piso rejilla" },
    { familia: "REJILLA" as const, colorId: negro?.id ?? null, base: "31", valor: 0.012, nota: "Negro: color muy intenso, lleva menos master" },
    { familia: "CIEGO" as const, colorId: null, base: "3", valor: 0.018, nota: "Más master para evitar pérdida de piezas en el cambio de color" },
  ];
  await db.transaction(async (tx) => {
    for (const d of dosificaciones) {
      if (d.nota.startsWith("Negro") && !negro) {
        reporte.observaciones.push("No se encontró el color Negro: no se cargó la excepción de master de rejilla negro.");
        continue;
      }
      const [ya] = await tx
        .select()
        .from(schema.dosificacionMaster)
        .where(
          and(
            eq(schema.dosificacionMaster.familia, d.familia),
            d.colorId == null ? isNull(schema.dosificacionMaster.colorId) : eq(schema.dosificacionMaster.colorId, d.colorId),
          ),
        );
      if (ya) {
        reporte.sinCambios++;
        continue;
      }
      const base = mpPorCodigo.get(d.base);
      const [nueva] = await tx
        .insert(schema.dosificacionMaster)
        .values({
          familia: d.familia,
          colorId: d.colorId,
          materiaPrimaBaseId: base?.id ?? null,
          kgPorKgMp: String(d.valor),
          observaciones: d.nota,
          actualizadoPorId: sistema.id,
        })
        .returning();
      await auditar(tx, sistema.id, "dosificacion_master", nueva.id, "kg_por_kg_mp", null, d.valor, "Carga inicial — Definiciones pendientes, respuesta 2");
      reporte.aplicado.push(`Master ${d.familia}${d.colorId ? " · Negro" : " (base)"}: ${d.valor} kg/kg sobre ${base?.nombre ?? "materia prima no encontrada"}`);
    }
    if (DRY_RUN) throw new Error("dry-run");
  }).catch(silenciarDryRun);

  // -------------------------------------------------------------------------
  // 5. Unidades por caja: la regla Rejilla 8 / Ciego 25 queda reemplazada
  //    por el parámetro unidades_por_caja_pisos (respuesta 4)
  // -------------------------------------------------------------------------
  await db.transaction(async (tx) => {
    for (const p of productos.filter((x) => x.unidadesPorCaja != null)) {
      await tx.update(schema.producto).set({ unidadesPorCaja: null }).where(eq(schema.producto.id, p.id));
      await auditar(
        tx,
        sistema.id,
        "producto",
        p.id,
        "unidades_por_caja",
        p.unidadesPorCaja,
        null,
        "Regla anterior Rejilla 8 / Ciego 25 reemplazada: pisos usan el parámetro unidades_por_caja_pisos (25) y los accesorios no se embalan (respuesta 4)",
      );
    }
    const n = productos.filter((x) => x.unidadesPorCaja != null).length;
    if (n > 0) reporte.aplicado.push(`${n} productos dejan de tener unidades por caja propias (8 o 25 de la regla anterior): pisos → parámetro general, accesorios → sin caja.`);
    if (DRY_RUN) throw new Error("dry-run");
  }).catch(silenciarDryRun);

  escribirReporte();
  await client.end();
}

function silenciarDryRun(e: unknown) {
  if (e instanceof Error && e.message === "dry-run") return;
  throw e;
}

function escribirReporte() {
  const md = `# Carga de configuración desde codigos.xlsx

> Generado por \`scripts/cargar-configuracion.ts\`${DRY_RUN ? " (simulación, sin guardar)" : ""} el ${new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.
> Cada cambio quedó en el historial del Panel Admin con el usuario “Importación (sistema)”.

## Aplicado (${reporte.aplicado.length})

${reporte.aplicado.map((l) => `- ${l}`).join("\n") || "- Nada: la base ya estaba al día."}

Valores que ya coincidían (sin cambios): ${reporte.sinCambios}.

## Observaciones e inconsistencias (${reporte.observaciones.length})

${reporte.observaciones.map((l) => `- ${l}`).join("\n")}
`;
  writeFileSync(path.resolve("docs/migracion-configuracion.md"), md);
  console.log(md);
}

main().catch(async (e) => {
  console.error(e);
  await client.end();
  process.exit(1);
});
