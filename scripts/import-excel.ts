/**
 * Importa los .xlsx de /data a Postgres — catálogo, materia prima, clientes y
 * pedidos. Alcance de R1 (docs/03-plan-release-1.md paso 1); producción,
 * partidas, lotes y trazabilidad llegan en R3/R4.
 *
 * IDEMPOTENTE Y NO DESTRUCTIVO — la regla que reemplaza al seed del mockup
 * (que borraba todo). Correrlo de nuevo tras actualizar los Excel:
 *  - upsert por clave natural (código de producto, código interno de MP,
 *    nombre de cliente): nunca duplica.
 *  - el stock inicial (movimiento IMPORTACION) sólo se crea la PRIMERA vez
 *    que se ve un producto o materia prima — así no se vuelve a sumar stock
 *    en cada corrida, y el stock cargado desde la app nunca se pisa.
 *  - los pedidos ya importados no se vuelven a tocar (se identifican por
 *    numeroOrden o, cuando falta, por una clave sintética estable).
 *
 * Emite docs/migracion-datos.md con el reporte de asunciones, igual que en
 * REINER.
 *
 * Uso: npm run db:import-excel
 */
if (!process.env.DATABASE_URL_UNPOOLED) {
  process.loadEnvFile(".env.local");
}

import path from "node:path";
import fs from "node:fs";
import XLSX from "xlsx";
import { eq, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";
import {
  COLORES,
  PROVEEDORES_MASTER,
  parseArticulo,
  resolverColorLibre,
  clasificarTipoMp,
  tipoCodigoDe,
  normalizarTexto,
  type FamiliaProducto,
  type TipoProducto,
} from "./lib/normalizacion-nexa";

const DIR_DATA = path.join(__dirname, "..", "data");
const ARCHIVO_STOCK_PISOS = "Stock pisos Nexa 11-08-2026.xlsx";
const ARCHIVO_STOCK_MP = "STOCK Materia prima  NEXA 11-08-2026-31-08-2026.xlsx";
const ARCHIVO_VENTAS = "Ventas Nexa.xlsx";

// ---------------------------------------------------------------------------
// Helpers de lectura
// ---------------------------------------------------------------------------

function filas(wb: XLSX.WorkBook, hoja: string): unknown[][] {
  const ws = wb.Sheets[hoja];
  if (!ws) throw new Error(`No se encontró la hoja "${hoja}"`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null }) as unknown[][];
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" || s === "-" ? null : s;
}

/** Número robusto a strings con coma decimal y celdas vacías/"-". */
function numero(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (s === "" || s === "-") return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function fecha(v: unknown): string | null {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = texto(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Reporte de migración
// ---------------------------------------------------------------------------

const reporte = {
  fecha: new Date().toISOString().slice(0, 10),
  catalogo: { total: 0, importados: 0, descartados: [] as string[], sinProveedor: [] as string[] },
  materiaPrima: { total: 0, importados: 0 },
  clientes: { importados: 0 },
  pedidos: {
    total: 0,
    importados: 0,
    lineas: 0,
    lineasSinSku: 0,
    accesoriosFamiliaAmbigua: 0,
    bordesConCantidadTexto: 0,
    estadosNoReconocidos: new Set<string>(),
    metodosPagoOriginales: new Set<string>(),
  },
};

// ---------------------------------------------------------------------------
// Conexión
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) throw new Error("Falta DATABASE_URL_UNPOOLED en .env.local");
const client = postgres(url, { prepare: false });
const db = drizzle(client, { schema });

async function main() {
  console.log("Importando NEXA...\n");

  // ── 0. Depósito y usuario del sistema (auditoría de los movimientos de
  //      importación — regla 2 del núcleo, ver AGENTS.md) ──────────────────
  const [deposito] = await db
    .insert(schema.deposito)
    .values({ nombre: "NEXA" })
    .onConflictDoNothing({ target: schema.deposito.nombre })
    .returning();
  const depositoNexa =
    deposito ??
    (await db.query.deposito.findFirst({ where: eq(schema.deposito.nombre, "NEXA") }))!;

  await db
    .insert(schema.deposito)
    .values({ nombre: "CPS", activo: false })
    .onConflictDoNothing({ target: schema.deposito.nombre });

  const [usuarioSistema] = await db
    .insert(schema.usuario)
    .values({ nombre: "Importación (sistema)", rol: "GERENCIA", activo: false })
    .onConflictDoNothing()
    .returning();
  let sistemaId = usuarioSistema?.id;
  if (!sistemaId) {
    const existente = await db.query.usuario.findFirst({
      where: eq(schema.usuario.nombre, "Importación (sistema)"),
    });
    sistemaId = existente!.id;
  }

  // ── 1. Colores y proveedores de master (catálogo canónico) ──────────────
  const colorIdPorNombre = new Map<string, number>();
  for (const c of COLORES) {
    const [row] = await db
      .insert(schema.color)
      .values({ nombre: c.nombre, iniciales: c.iniciales, oficial: false })
      .onConflictDoUpdate({
        target: schema.color.nombre,
        set: { iniciales: c.iniciales },
      })
      .returning();
    colorIdPorNombre.set(c.nombre, row.id);
  }

  const proveedorIdPorLetra = new Map<string, number>();
  for (const p of PROVEEDORES_MASTER) {
    const [row] = await db
      .insert(schema.proveedorMaster)
      .values({ nombre: p.nombre, inicial: p.inicial })
      .onConflictDoUpdate({ target: schema.proveedorMaster.nombre, set: { nombre: p.nombre } })
      .returning();
    proveedorIdPorLetra.set(p.inicial, row.id);
  }

  // ── 2. Catálogo de productos ─────────────────────────────────────────────
  const wbStock = XLSX.readFile(path.join(DIR_DATA, ARCHIVO_STOCK_PISOS), { cellDates: true });
  const stockRows = filas(wbStock, "STOCK").slice(2); // fila 1 vacía, fila 2 encabezados

  for (const r of stockRows) {
    const numeroCol = r[0];
    if (numeroCol === null || numeroCol === undefined || String(numeroCol).trim() === "") continue;
    reporte.catalogo.total++;

    const parsed = parseArticulo(numeroCol, r[2]);
    if (!parsed) {
      reporte.catalogo.descartados.push(`${numeroCol} · "${texto(r[2]) ?? ""}"`);
      continue;
    }
    if (!parsed.color) {
      reporte.catalogo.descartados.push(
        `${numeroCol} · color no reconocido: "${parsed.colorTexto}"`,
      );
      continue;
    }

    const proveedorId = parsed.letraProveedor
      ? (proveedorIdPorLetra.get(parsed.letraProveedor) ?? null)
      : null;
    if (!proveedorId) {
      reporte.catalogo.sinProveedor.push(`${numeroCol} · letra "${parsed.letraProveedor ?? ""}"`);
    }

    const tipoCodigo = tipoCodigoDe(parsed.familia, parsed.tipo);
    if (!tipoCodigo) {
      reporte.catalogo.descartados.push(
        `${numeroCol} · combinación familia/tipo sin código: ${parsed.familia}/${parsed.tipo}`,
      );
      continue;
    }
    const colorId = colorIdPorNombre.get(parsed.color.nombre)!;
    const codigo = `${parsed.numero}${parsed.letraProveedor ?? ""}-${tipoCodigo}-${parsed.color.iniciales}`;

    const esAccesorio = parsed.tipo === "BORDE" || parsed.tipo === "ESQUINERO" || parsed.tipo === "RAMPA";

    const m2 = numero(r[8]);
    const minimo = numero(r[10]); // columna "MINIMO" — ver docs/01-analisis.md §6 pregunta 8
    const maximo = numero(r[9]); // columna "MAXIMO", vacía en casi todo el Excel

    const [row] = await db
      .insert(schema.producto)
      .values({
        numero: parsed.numero,
        codigo,
        descripcion: texto(r[2]) ?? codigo,
        familia: parsed.familia,
        tipo: parsed.tipo,
        tipoCodigo,
        colorId,
        proveedorMasterId: proveedorId,
        m2PorUnidad: m2 !== null ? String(m2) : parsed.tipo === "UNICO" || parsed.tipo === "MONEDA" || parsed.tipo === "TRAMA" ? "0.16" : null,
        kgPorUnidad: parsed.tipo === "UNICO" || parsed.tipo === "MONEDA" || parsed.tipo === "TRAMA" ? "0.610" : null,
        piezasPorGolpe: parsed.tipo === "RAMPA" ? 2 : parsed.tipo === "ESQUINERO" || parsed.tipo === "BORDE" ? 4 : 1,
        unidadesPorCaja: parsed.familia === "REJILLA" ? 8 : 25, // docs/01-analisis.md §3.9 — pregunta 9 pendiente
        esAccesorio,
        minimo: minimo !== null ? Math.round(minimo) : null,
        maximo: maximo !== null ? Math.round(maximo) : null,
      })
      .onConflictDoUpdate({
        target: schema.producto.codigo,
        set: {
          descripcion: texto(r[2]) ?? codigo,
          minimo: minimo !== null ? Math.round(minimo) : undefined,
          maximo: maximo !== null ? Math.round(maximo) : undefined,
        },
      })
      .returning();

    reporte.catalogo.importados++;

    // Stock inicial — sólo si este producto nunca recibió su movimiento de
    // importación (evita duplicar stock en corridas siguientes).
    const yaImportado = await db.query.movimiento.findFirst({
      where: and(
        eq(schema.movimiento.productoId, row.id),
        eq(schema.movimiento.depositoId, depositoNexa.id),
        eq(schema.movimiento.origen, "IMPORTACION"),
      ),
    });
    const stockActual = numero(r[7]) ?? 0; // "STOCK A FECHA 2"
    if (!yaImportado) {
      await db.transaction(async (tx) => {
        await tx.insert(schema.movimiento).values({
          tipo: "ENTRADA",
          depositoId: depositoNexa.id,
          productoId: row.id,
          cantidad: String(stockActual),
          origen: "IMPORTACION",
          motivo: `Snapshot del Excel al ${texto(r[4] as string) ? "07/08/2026" : "11/08/2026"}`,
          usuarioId: sistemaId!,
        });
        await tx
          .insert(schema.saldo)
          .values({ depositoId: depositoNexa.id, productoId: row.id, cantidad: String(stockActual) })
          .onConflictDoUpdate({
            target: [schema.saldo.depositoId, schema.saldo.productoId],
            set: { cantidad: String(stockActual) },
          });
      });
    }
  }

  console.log(
    `Catálogo: ${reporte.catalogo.importados}/${reporte.catalogo.total} importados, ` +
      `${reporte.catalogo.descartados.length} descartados.`,
  );

  // ── 3. Materia prima ─────────────────────────────────────────────────────
  const wbMp = XLSX.readFile(path.join(DIR_DATA, ARCHIVO_STOCK_MP), { cellDates: true });
  const mpRows = filas(wbMp, "STOCK").slice(4); // 3 filas de título/encabezado

  for (const r of mpRows) {
    const codigoRaw = texto(r[0]);
    if (!codigoRaw) continue;
    // Ignora la fila de sub-encabezado "CODIGO INTERNO | Sobrantes y moliendas"
    if (normalizarTexto(codigoRaw).includes("codigo interno")) continue;
    reporte.materiaPrima.total++;

    const codigoInterno = codigoRaw.replace(/\s+/g, "");
    const nombre = texto(r[1]) ?? codigoInterno;
    const tipo = clasificarTipoMp(nombre);
    const minimo = numero(r[9]);
    const maximo = numero(r[10]);
    const stockActual = numero(r[5]) ?? 0; // "STOCK A FECHA 11/08/2026"

    const [row] = await db
      .insert(schema.materiaPrima)
      .values({
        codigoInterno,
        nombre,
        tipo,
        minimo: minimo !== null ? String(minimo) : null,
        maximo: maximo !== null ? String(maximo) : null,
      })
      .onConflictDoUpdate({
        target: schema.materiaPrima.codigoInterno,
        set: {
          nombre,
          minimo: minimo !== null ? String(minimo) : undefined,
          maximo: maximo !== null ? String(maximo) : undefined,
        },
      })
      .returning();
    reporte.materiaPrima.importados++;

    const yaImportado = await db.query.movimiento.findFirst({
      where: and(
        eq(schema.movimiento.materiaPrimaId, row.id),
        eq(schema.movimiento.depositoId, depositoNexa.id),
        eq(schema.movimiento.origen, "IMPORTACION"),
      ),
    });
    if (!yaImportado) {
      await db.transaction(async (tx) => {
        await tx.insert(schema.movimiento).values({
          tipo: "ENTRADA",
          depositoId: depositoNexa.id,
          materiaPrimaId: row.id,
          cantidad: String(stockActual),
          origen: "IMPORTACION",
          motivo: "Snapshot del Excel al 11/08/2026",
          usuarioId: sistemaId!,
        });
        await tx
          .insert(schema.saldo)
          .values({ depositoId: depositoNexa.id, materiaPrimaId: row.id, cantidad: String(stockActual) })
          .onConflictDoUpdate({
            target: [schema.saldo.depositoId, schema.saldo.materiaPrimaId],
            set: { cantidad: String(stockActual) },
          });
      });
    }
  }
  console.log(`Materia prima: ${reporte.materiaPrima.importados}/${reporte.materiaPrima.total} importados.`);

  // ── 4. Clientes y pedidos ────────────────────────────────────────────────
  const wbVentas = XLSX.readFile(path.join(DIR_DATA, ARCHIVO_VENTAS), { cellDates: true });
  const ventasRows = filas(wbVentas, "Hoja1").slice(2); // 2 filas de encabezado

  const clienteIdPorNombre = new Map<string, number>();

  let fila = 0;
  for (const r of ventasRows) {
    fila++;
    const nombreCliente = texto(r[0]);
    if (!nombreCliente) continue;
    reporte.pedidos.total++;

    // Cliente
    let clienteId = clienteIdPorNombre.get(normalizarTexto(nombreCliente));
    if (!clienteId) {
      const [c] = await db
        .insert(schema.cliente)
        .values({ nombre: nombreCliente })
        .onConflictDoUpdate({ target: schema.cliente.nombre, set: { nombre: nombreCliente } })
        .returning();
      clienteId = c.id;
      clienteIdPorNombre.set(normalizarTexto(nombreCliente), clienteId);
      reporte.clientes.importados++;
    }

    // Clave del pedido: el N° de orden cuando existe (22/69 lo tienen — ver
    // docs/01-analisis.md); si no, una clave sintética estable por posición de
    // fila, para que la importación sea idempotente igual.
    const numeroOrden = texto(r[1]) ?? `IMPORT-VENTAS-F${fila}`;

    const yaExiste = await db.query.pedido.findFirst({
      where: eq(schema.pedido.numeroOrden, numeroOrden),
    });
    if (yaExiste) continue; // pedido ya importado en una corrida anterior

    const estadoOriginal = texto(r[18]) ?? "PEDIDO";
    const estadoNorm = normalizarTexto(estadoOriginal);
    let estado: (typeof schema.estadoPedidoEnum.enumValues)[number];
    if (estadoNorm === "pedido") estado = "PEDIDO";
    else if (estadoNorm === "listo para retirar") estado = "LISTO_PARA_DESPACHAR";
    else if (["despachado", "entregado", "ganador sorteo"].includes(estadoNorm)) estado = "ENTREGADO";
    else {
      estado = "ENTREGADO";
      reporte.pedidos.estadosNoReconocidos.add(estadoOriginal);
    }
    if (texto(r[14])) reporte.pedidos.metodosPagoOriginales.add(texto(r[14])!);

    const total = numero(r[15]);
    const senia = numero(r[16]);

    const [pedido] = await db
      .insert(schema.pedido)
      .values({
        numeroOrden,
        clienteId,
        fechaPedido: fecha(r[2]) ?? "2026-01-01",
        estado,
        contacto: texto(r[3]),
        domicilioEntrega: texto(r[4]),
        total: total !== null ? String(total) : null,
        senia: senia !== null ? String(senia) : null,
        observaciones: texto(r[19]),
        usuarioId: sistemaId,
      })
      .returning();
    reporte.pedidos.importados++;

    // Líneas de piso: cada columna ya trae su propia familia.
    type LineaPiso = { familia: FamiliaProducto; tipo: TipoProducto; cantidad: number };
    const lineasPiso: LineaPiso[] = [];
    const cantRejilla = numero(r[6]);
    const cantTrama = numero(r[7]);
    const cantMoneda = numero(r[8]);
    if (cantRejilla) lineasPiso.push({ familia: "REJILLA", tipo: "UNICO", cantidad: cantRejilla });
    if (cantTrama) lineasPiso.push({ familia: "CIEGO", tipo: "TRAMA", cantidad: cantTrama });
    if (cantMoneda) lineasPiso.push({ familia: "CIEGO", tipo: "MONEDA", cantidad: cantMoneda });

    const colorPisoTexto = texto(r[9]);
    const familiasUnicas = new Set(lineasPiso.map((l) => l.familia));

    for (const l of lineasPiso) {
      await crearLineaPedido(pedido.id, l.familia, l.tipo, colorPisoTexto);
    }

    // Accesorios: BORDES y ESQUINEROS no traen su propia columna de familia —
    // se asume la del piso pedido en la misma línea (docs/01-analisis.md §6
    // pregunta 8). Si hay más de una familia de piso en la fila, o no hay
    // ninguna, queda sin resolver (familia REJILLA por defecto, sin SKU).
    const familiaAccesorio: FamiliaProducto =
      familiasUnicas.size === 1 ? [...familiasUnicas][0] : "REJILLA";
    if (familiasUnicas.size !== 1 && (r[10] || r[12])) reporte.pedidos.accesoriosFamiliaAmbigua++;

    const rawBordes = r[10];
    if (rawBordes !== null && rawBordes !== undefined && String(rawBordes).trim() !== "" && String(rawBordes).trim() !== "-") {
      const cantBordes = numero(rawBordes);
      if (cantBordes === null) reporte.pedidos.bordesConCantidadTexto++;
      await crearLineaPedido(
        pedido.id,
        familiaAccesorio,
        "BORDE",
        texto(r[11]),
        cantBordes ?? 0,
      );
    }
    const cantEsquineros = numero(r[12]);
    if (cantEsquineros) {
      await crearLineaPedido(pedido.id, familiaAccesorio, "ESQUINERO", texto(r[13]), cantEsquineros);
    }
  }

  async function crearLineaPedido(
    pedidoId: number,
    familia: FamiliaProducto,
    tipo: TipoProducto,
    colorTexto: string | null,
    cantidadForzada?: number,
  ) {
    const color = resolverColorLibre(colorTexto);
    let productoId: number | null = null;
    if (color) {
      // Busca el producto sin importar el proveedor de master (el pedido no
      // lo especifica) — el primero que matchee familia/tipo/color.
      const candidato = await db.query.producto.findFirst({
        where: and(
          eq(schema.producto.familia, familia),
          eq(schema.producto.tipo, tipo),
          eq(schema.producto.colorId, colorIdPorNombre.get(color.nombre)!),
        ),
      });
      productoId = candidato?.id ?? null;
    }
    if (!productoId) reporte.pedidos.lineasSinSku++;
    reporte.pedidos.lineas++;

    await db.insert(schema.pedidoLinea).values({
      pedidoId,
      productoId,
      colorTexto,
      unidadesPedidas: Math.max(1, Math.round(cantidadForzada ?? 0)) || 1,
    });
  }

  console.log(
    `Pedidos: ${reporte.pedidos.importados}/${reporte.pedidos.total} importados ` +
      `(${reporte.pedidos.total - reporte.pedidos.importados} ya existían), ` +
      `${reporte.pedidos.lineas} líneas, ${reporte.pedidos.lineasSinSku} sin SKU resuelto.`,
  );

  await client.end();
  escribirReporte();
  console.log("\nListo. Reporte en docs/migracion-datos.md");
}

// ---------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------

function escribirReporte() {
  const md = `# Reporte de importación

> Auto-generado por \`scripts/import-excel.ts\` el ${reporte.fecha}. No editar a
> mano — se sobreescribe en cada corrida. Las asunciones de fondo están
> justificadas en \`docs/01-analisis.md\`.

## Catálogo de productos

${reporte.catalogo.importados} de ${reporte.catalogo.total} filas con NUMERO se importaron como producto.

${
  reporte.catalogo.descartados.length
    ? `**Descartadas (${reporte.catalogo.descartados.length}):**\n\n${reporte.catalogo.descartados.map((d) => `- ${d}`).join("\n")}`
    : "Ninguna fila descartada."
}

${
  reporte.catalogo.sinProveedor.length
    ? `\n**Sin proveedor de master identificado (${reporte.catalogo.sinProveedor.length})** — quedan con \`proveedorMasterId\` null:\n\n${reporte.catalogo.sinProveedor.map((d) => `- ${d}`).join("\n")}`
    : ""
}

## Materia prima

${reporte.materiaPrima.importados} de ${reporte.materiaPrima.total} filas importadas.

## Clientes

${reporte.clientes.importados} clientes nuevos (docs/01-analisis.md §6 pregunta 10 — falta la base real de ~360).

## Pedidos

- ${reporte.pedidos.importados} pedidos importados de ${reporte.pedidos.total} filas (el resto ya existía de una corrida anterior).
- ${reporte.pedidos.lineas} líneas de pedido generadas, **${reporte.pedidos.lineasSinSku} sin SKU resuelto** (color multicolor o no reconocido — quedan para asignación manual, docs/01-analisis.md §6 pregunta 5).
- ${reporte.pedidos.accesoriosFamiliaAmbigua} filas con accesorio (borde/esquinero) donde la familia se asumió por default (REJILLA) al haber más de una familia de piso en la misma fila, o ninguna — docs/01-analisis.md §6 pregunta 8.
- ${reporte.pedidos.bordesConCantidadTexto} filas con "Si" en la columna de bordes (cantidad sin especificar) — se cargaron con cantidad 1 para revisar.

**Estados no reconocidos** (se importaron como ENTREGADO):
${reporte.pedidos.estadosNoReconocidos.size ? [...reporte.pedidos.estadosNoReconocidos].map((e) => `- "${e}"`).join("\n") : "Ninguno."}

**Variantes de método de pago originales** (se guardan tal cual, sin normalizar todavía):
${[...reporte.pedidos.metodosPagoOriginales].map((e) => `- "${e}"`).join("\n")}

## Qué no se importa en esta etapa

Partidas, ciclos de producción, lotes de materia prima y certificados de
calidad son R3/R4 (docs/02-modelo-datos.md §7) — no se leen todavía, aunque
estén en \`/data\` (\`CARGA INYECTORAS...\`, \`N° DE PARTIDA\`).
`;
  fs.writeFileSync(path.join(__dirname, "..", "docs", "migracion-datos.md"), md);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
