/**
 * Normalización de los datos de NEXA — catálogo, colores, materia prima.
 *
 * El principio de docs/01-analisis.md §3.1: el código de producto SE DERIVA,
 * nunca se copia del Excel. Prueba concreta de por qué (encontrada al analizar
 * `Stock pisos Nexa 11-08-2026.xlsx`): la columna CODIGO DE BARRAS del propio
 * Excel usa "AO" tanto para Azul Oscuro como para Azul claro, y "GC" tanto para
 * Gris Claro como para Celeste. Si el importador confiara en esas iniciales,
 * heredaría la ambigüedad. En cambio, se parsea el texto de ARTICULO (que sí es
 * consistente: "001B-Rejilla -Unico - Negro") y las iniciales se derivan de la
 * tabla canónica de colores de este archivo.
 */

export type ColorCanonico = { nombre: string; iniciales: string; alias: string[] };

/**
 * Lista deducida de los ~95 productos del catálogo (asunción de
 * docs/03-plan-release-1.md — PENDIENTE pregunta 1 del cliente: la lista
 * oficial). Las iniciales se eligieron para no colisionar entre sí, a
 * diferencia de las del Excel original.
 */
export const COLORES: ColorCanonico[] = [
  { nombre: "Negro", iniciales: "NE", alias: ["negro"] },
  { nombre: "Gris Oscuro", iniciales: "GO", alias: ["gris oscuro"] },
  { nombre: "Gris Claro", iniciales: "GC", alias: ["gris claro"] },
  { nombre: "Blanco", iniciales: "BL", alias: ["blanco"] },
  { nombre: "Celeste", iniciales: "CE", alias: ["celeste"] },
  { nombre: "Azul Claro", iniciales: "AC", alias: ["azul claro", "azul"] },
  { nombre: "Azul Oscuro", iniciales: "AO", alias: ["azul oscuro", "azul  oscuro"] },
  { nombre: "Amarillo", iniciales: "AM", alias: ["amarillo"] },
  // "Verde" a secas (sin calificador) se usa en el Excel para un subconjunto de
  // Ciego-Esquinero/Rampa; se asume Verde Claro por el correlativo de códigos
  // (089/092 son explícitamente "Verde oscuro"). Asunción a confirmar.
  { nombre: "Verde Claro", iniciales: "VC", alias: ["verde claro", "verde"] },
  { nombre: "Verde Oscuro", iniciales: "VO", alias: ["verde oscuro"] },
  { nombre: "Rojo", iniciales: "RO", alias: ["rojo"] },
  { nombre: "Naranja", iniciales: "NA", alias: ["naranja"] },
  { nombre: "Yute", iniciales: "YU", alias: ["yute"] },
  // Aparece en 3 productos nuevos (200A-202A) y en la lista de materia prima
  // como dos masters separados (A12 Violeta, A13 Obispo) — se asume que
  // "Violeta Obispo" es el nombre de UN color (el tono que en la industria del
  // color se llama "morado obispo"). A confirmar con el cliente.
  { nombre: "Violeta Obispo", iniciales: "VI", alias: ["violeta obispo", "violeta", "obispo"] },
];

const ALIAS_A_COLOR = new Map<string, ColorCanonico>();
for (const c of COLORES) {
  for (const a of c.alias) ALIAS_A_COLOR.set(normalizarTexto(a), c);
}

export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Resuelve un color a partir de un único token de texto (catálogo, no pedidos). */
export function resolverColor(texto: string): ColorCanonico | null {
  return ALIAS_A_COLOR.get(normalizarTexto(texto)) ?? null;
}

/**
 * Resuelve el color de una línea de pedido, que puede venir como texto libre
 * multicolor ("Gris oscuro y amarillo", "Negro, blanco y rojo") — docs/01-
 * analisis.md §6 pregunta 5. Sólo se resuelve a un color de catálogo cuando el
 * texto entero, limpio, matchea UN solo color. Cualquier otra cosa (multicolor,
 * no reconocido) devuelve null y el texto crudo queda para asignación manual —
 * nunca se inventa ni se parte a mano.
 */
export function resolverColorLibre(texto: string | null | undefined): ColorCanonico | null {
  if (!texto) return null;
  const t = normalizarTexto(texto);
  if (t === "-" || t === "") return null;
  return ALIAS_A_COLOR.get(t) ?? null;
}

export type ProveedorMasterCanonico = { nombre: string; inicial: string };

/** docs/01-analisis.md §3.1 y el procedimiento firmado. */
export const PROVEEDORES_MASTER: ProveedorMasterCanonico[] = [
  { nombre: "Berma", inicial: "B" },
  { nombre: "Arcolor", inicial: "A" },
  { nombre: "Platsur", inicial: "P" },
];

export type FamiliaProducto = "REJILLA" | "CIEGO";
export type TipoProducto = "UNICO" | "TRAMA" | "MONEDA" | "BORDE" | "ESQUINERO" | "RAMPA";

/** El código de tipo que va en el código de producto derivado (§3.1). Fijo por
 *  (familia, tipo) — nunca se copia del Excel, donde aparece como PR/ER/RR/PM/
 *  PT/EC/RC pero también variantes irregulares (PCT, RM, RCAJAS...). */
const TIPO_CODIGO: Record<string, string> = {
  "REJILLA:UNICO": "PR",
  "REJILLA:ESQUINERO": "ER",
  "REJILLA:RAMPA": "RR",
  "REJILLA:BORDE": "BR",
  "CIEGO:MONEDA": "PM",
  "CIEGO:TRAMA": "PT",
  "CIEGO:ESQUINERO": "EC",
  "CIEGO:RAMPA": "RC",
  "CIEGO:BORDE": "BC",
};

export function tipoCodigoDe(familia: FamiliaProducto, tipo: TipoProducto): string | null {
  return TIPO_CODIGO[`${familia}:${tipo}`] ?? null;
}

const TIPO_TEXTO: Record<string, TipoProducto> = {
  unico: "UNICO",
  trama: "TRAMA",
  moneda: "MONEDA",
  borde: "BORDE",
  bordes: "BORDE",
  esquinero: "ESQUINERO",
  esquineros: "ESQUINERO",
  rampa: "RAMPA",
};

const FAMILIA_TEXTO: Record<string, FamiliaProducto> = {
  rejilla: "REJILLA",
  ciego: "CIEGO",
};

export type ArticuloParseado = {
  numero: string;
  letraProveedor: string | null;
  familia: FamiliaProducto;
  tipo: TipoProducto;
  colorTexto: string;
  color: ColorCanonico | null;
};

/**
 * Parsea "001B-Rejilla -Unico - Negro" → {numero: "001", letraProveedor: "B",
 * familia: REJILLA, tipo: UNICO, color: Negro}.
 *
 * Devuelve null cuando la fila no matchea el patrón — filas descartadas
 * observadas en el Excel real: encabezados sueltos con el texto de familia
 * pegado en la columna NUMERO ("Rejil", "Ciego", todas con stock 0), y dos
 * artículos que no son pisos ("Grampa de union", "CAJAS CHICAS"). Se listan
 * en el reporte de migración, no se importan como producto.
 */
export function parseArticulo(numeroCol: unknown, articuloCol: unknown): ArticuloParseado | null {
  const numeroRaw = String(numeroCol ?? "").trim();
  if (!/^\d/.test(numeroRaw)) return null; // descarta "Rejil"/"Ciego" sueltos

  // Guiones finales sueltos: en el Excel real hay filas con uno ("001B-") y
  // con dos ("016--") — se aceptan todos.
  const m = numeroRaw.match(/^(\d+)([A-Za-z]?)-*$/);
  if (!m) return null;
  const [, numero, letra] = m;

  const articulo = String(articuloCol ?? "").trim();
  const partes = articulo
    .split("-")
    .map((p) => p.trim())
    .filter(Boolean);
  if (partes.length < 3) return null; // "Grampa de union", "CAJAS CHICAS"

  const familia = FAMILIA_TEXTO[normalizarTexto(partes[1])];
  if (!familia) return null;

  const tipo = TIPO_TEXTO[normalizarTexto(partes[2])];
  if (!tipo) return null;

  // El color es la parte siguiente; algunas filas nuevas (200A-202A) traen un
  // sufijo "-A" repetido al final que se ignora.
  const colorTexto = partes[3] ?? "";
  const color = resolverColor(colorTexto);

  return {
    numero: numero.padStart(3, "0"),
    letraProveedor: letra || null,
    familia,
    tipo,
    colorTexto,
    color,
  };
}

export type TipoMp = "VIRGEN" | "MASTER" | "MOLIENDA" | "SOBRANTE" | "MUESTRA";

/**
 * Clasifica el tipo de materia prima por el nombre — la hoja STOCK del Excel
 * no tiene columna de tipo, pero el nombre lo dice consistentemente
 * ("...Master...", "...molienda...", "...sobrante..."). Ver docs/01-
 * analisis.md §3.5: sobrantes y moliendas son resultado de transformaciones,
 * no una categoría de compra.
 */
export function clasificarTipoMp(nombre: string): TipoMp {
  const n = normalizarTexto(nombre);
  if (n.includes("molienda")) return "MOLIENDA";
  if (n.includes("sobrante") || n.includes("sobante")) return "SOBRANTE";
  if (n.includes("master")) return "MASTER";
  return "VIRGEN";
}
