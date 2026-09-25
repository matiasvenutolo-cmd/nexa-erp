/**
 * Parseo específico de los Excel de NEXA. La normalización canónica
 * (colores, proveedores de master, derivación del código) vive en
 * `src/lib/catalogo-normalizacion.ts` — este archivo la reexporta y le
 * agrega sólo lo que necesita el importador: parsear el texto de ARTICULO y
 * clasificar el tipo de materia prima por nombre.
 */
export {
  COLORES,
  PROVEEDORES_MASTER,
  normalizarTexto,
  resolverColor,
  resolverColorLibre,
  tipoCodigoDe,
  type ColorCanonico,
  type ProveedorMasterCanonico,
  type FamiliaProducto,
  type TipoProducto,
} from "../../src/lib/catalogo-normalizacion";

import { normalizarTexto, resolverColor, type ColorCanonico, type FamiliaProducto, type TipoProducto } from "../../src/lib/catalogo-normalizacion";

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
