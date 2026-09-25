/**
 * Normalización canónica del catálogo — colores, proveedores de master, y la
 * derivación del código de producto. Es la MISMA lógica que usa el importador
 * (`scripts/import-excel.ts`, que re-exporta desde acá) y la que usa el alta
 * de producto nuevo desde el formulario de pedido (§5 de
 * docs/06-comentarios-produccion.md) — una sola fuente, para que un producto
 * cargado a mano y uno importado del Excel salgan con el mismo criterio.
 *
 * El principio de docs/01-analisis.md §3.1: el código de producto SE DERIVA,
 * nunca se copia ni se tipea. Prueba concreta de por qué: la columna CODIGO DE
 * BARRAS del propio Excel usa "AO" tanto para Azul Oscuro como para Azul
 * claro — si confiáramos en esas iniciales, heredaríamos la ambigüedad.
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

export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const ALIAS_A_COLOR = new Map<string, ColorCanonico>();
for (const c of COLORES) {
  for (const a of c.alias) ALIAS_A_COLOR.set(normalizarTexto(a), c);
}

/** Resuelve un color existente a partir de un único token de texto. */
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

const CONSONANTES = "BCDFGHJKLMNPQRSTVWXYZ";

/**
 * Genera iniciales de 2 letras para un color NUEVO que no está en `COLORES` —
 * el alta de producto desde el formulario de pedido (docs/06-comentarios-
 * produccion.md §5) las necesita para poder derivar el código. Nunca se
 * inventan a mano: se sacan del propio nombre, y si colisionan con un color
 * ya usado, se corrige con la letra siguiente antes de probar con un número.
 */
export function generarIniciales(nombreColor: string, yaUsadas: Set<string>): string {
  const limpio = normalizarTexto(nombreColor).toUpperCase().replace(/[^A-Z ]/g, "");
  const palabras = limpio.split(" ").filter(Boolean);
  const letras = (palabras[0] ?? "XX").split("");

  const candidatos: string[] = [];
  // 1) primeras dos letras de la primera palabra
  if (letras.length >= 2) candidatos.push(letras[0] + letras[1]);
  // 2) primera letra de cada una de las dos primeras palabras
  if (palabras.length >= 2) candidatos.push(palabras[0][0] + palabras[1][0]);
  // 3) primera + primera consonante siguiente de la palabra
  const consonante = letras.slice(1).find((l) => CONSONANTES.includes(l));
  if (consonante) candidatos.push(letras[0] + consonante);

  for (const c of candidatos) if (c.length === 2 && !yaUsadas.has(c)) return c;

  // Sin candidato libre: primera letra + dígito.
  const base = letras[0] ?? "X";
  for (let n = 0; n <= 9; n++) {
    const c = `${base}${n}`;
    if (!yaUsadas.has(c)) return c;
  }
  // Prácticamente imposible de alcanzar (haría falta un color por cada
  // combinación letra+dígito), pero no se deja sin devolver algo.
  return `${base}X`;
}
