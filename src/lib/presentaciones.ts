/**
 * Cantidades físicas para la planta (minuta 15/10): el operario ve "2 bolsas"
 * y "1 bolsita de 600 g", nunca "0,046 kg". Funciones puras, sin base de datos.
 *
 * Las conversiones se hacen en gramos enteros para no acumular errores de
 * coma flotante (0,6 × 3 = 1,7999… en binario).
 */

/** kg → gramos enteros. */
export function aGramos(kg: number): number {
  return Math.round(kg * 1000);
}

/** Cantidad de presentaciones × kg de la presentación, exacto. */
export function kgDe(cantidad: number, kgPresentacion: number): number {
  // cantidad admite medias (0,5): se trabaja en medios gramos enteros.
  return (Math.round(cantidad * 2) * aGramos(kgPresentacion)) / 2 / 1000;
}

/** "2", "1½", "½" — admite medias bolsas. */
export function fmtCantidadBolsas(cantidad: number): string {
  const enteras = Math.floor(cantidad + 1e-9);
  const media = Math.abs(cantidad - enteras - 0.5) < 1e-6;
  if (media) return enteras === 0 ? "½" : `${enteras}½`;
  return String(Math.round(cantidad * 100) / 100).replace(".", ",");
}

/** Peso legible: el master siempre en gramos; el resto en kg sin decimales
 *  innecesarios. 1.500 kg se escribe con punto de miles, nunca "1,5". */
/** Bolsas de material (sin contar el master) que entran en el mezclador por
 *  carga: «es máximo 4, cuando hay un pedido grande son de a cuatro»
 *  (reunión 20/11/2026). */
export const BOLSAS_MAX_POR_CARGA = 4;

export function fmtPeso(kg: number, opciones: { gramos?: boolean } = {}): string {
  if (opciones.gramos || Math.abs(kg) < 1) {
    return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(aGramos(kg))} g`;
  }
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(Math.round(kg * 1000) / 1000)} kg`;
}

/** "2 bolsas", "1 bolsita", "½ bolsa" a partir del nombre de la presentación
 *  ("Bolsa 25 kg" → bolsa, "Bolsita 600 g" → bolsita). */
export function fmtPresentacion(cantidad: number, nombrePresentacion: string): string {
  const palabra = nombrePresentacion.trim().split(/\s+/)[0]?.toLowerCase() || "unidad";
  const plural = cantidad > 1 + 1e-9 ? (palabra.endsWith("a") ? `${palabra}s` : `${palabra}es`) : palabra;
  const resto = nombrePresentacion.trim().split(/\s+/).slice(1).join(" ");
  return `${fmtCantidadBolsas(cantidad)} ${plural}${resto ? ` de ${resto}` : ""}`;
}

/**
 * Interpreta una cantidad escrita a mano con la convención argentina, para
 * evitar el error de carga "1.500 kg registrados como 1,5":
 *   "1.500" → 1500 · "1.500,5" → 1500.5 · "1,5" → 1.5 · "4500" → 4500
 * Un punto seguido de exactamente tres dígitos es separador de miles. Si el
 * texto es ambiguo o inválido devuelve null (la pantalla pide corregirlo).
 */
export function parseCantidadAR(texto: string): number | null {
  const t = texto.trim().replace(/\s+/g, "").replace(/kg$/i, "");
  if (!t) return null;
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^-?\d+(,\d+)?$/.test(t)) return Number(t.replace(",", "."));
  // Un único punto que no es de miles ("1.5", "12.75"): se toma como decimal
  // sólo si no hay coma; lo informa la vista previa para que se confirme.
  if (/^-?\d+\.\d{1,2}$/.test(t) || /^-?\d+\.\d{4,}$/.test(t)) return Number(t);
  return null;
}

/**
 * Kilos expresados en bolsas: la combinación de hasta dos presentaciones que
 * da exacto con menos bolsas (0,675 kg = bolsita de 375 g + bolsita de 300 g;
 * 35 kg = bolsa de 25 kg + medida de 10 kg); una sola presentación si la
 * combinación no ahorra más de una bolsa (4,8 kg = 8 bolsitas de 600 g). Media
 * bolsa sólo en las de 1 kg o más. Si nada da exacto, la más grande que entra
 * entera y el resto en peso.
 * Null si no entra ni una.
 */
export function enBolsas(kg: number, pres: { nombre: string; kg: number }[]): string | null {
  const g = aGramos(kg);
  if (g <= 0 || pres.length === 0) return null;
  // Unidad mínima de cada presentación: media bolsa en las bolsas de 1 kg o
  // más (se usa media bolsa de 25 kg); las bolsitas de master, enteras.
  const ps = [...pres].sort((a, b) => b.kg - a.kg).map((p) => ({ ...p, g: aGramos(p.kg), paso: p.kg >= 1 ? aGramos(p.kg) / 2 : aGramos(p.kg) }));
  // Hasta dos presentaciones que den exacto, con la menor cantidad de bolsas
  // (reunión 10/11/2026: 0,675 kg = bolsita de 375 g + bolsita de 300 g).
  type Opcion = { partes: { p: (typeof ps)[number]; cant: number }[]; bolsas: number };
  let mejor: Opcion | null = null;
  // Una sola presentación se lee mejor: dos se combinan sólo si ahorran más de una bolsa.
  const puntaje = (o: Opcion) => o.bolsas + (o.partes.length - 1);
  const probar = (o: Opcion) => {
    if (!mejor || puntaje(o) < puntaje(mejor) || (puntaje(o) === puntaje(mejor) && o.partes.length < mejor.partes.length)) mejor = o;
  };
  const bolsas = (cant: number) => Math.ceil(cant);
  for (const p1 of ps) {
    for (let n1 = 1; n1 * p1.paso <= g && n1 <= 200; n1++) {
      const resto = g - n1 * p1.paso;
      const c1 = (n1 * p1.paso) / p1.g;
      if (resto === 0) {
        probar({ partes: [{ p: p1, cant: c1 }], bolsas: bolsas(c1) });
        continue;
      }
      for (const p2 of ps) {
        if (p2 === p1 || resto % p2.paso !== 0) continue;
        const c2 = resto / p2.g;
        probar({ partes: [{ p: p1, cant: c1 }, { p: p2, cant: c2 }], bolsas: bolsas(c1) + bolsas(c2) });
      }
    }
  }
  const m = mejor as Opcion | null;
  if (m) return m.partes.sort((a, b) => b.p.kg - a.p.kg).map((x) => fmtPresentacion(x.cant, x.p.nombre)).join(" + ");
  // Sin combinación exacta: bolsas enteras de la más grande que entre y el resto en peso.
  const p = ps.find((x) => x.g <= g);
  if (!p) return null;
  const cant = Math.floor(g / p.g);
  const resto = g - cant * p.g;
  const fmtResto = resto >= 1000 ? `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(resto / 1000)} kg` : `${resto} g`;
  return `${fmtPresentacion(cant, p.nombre)}${resto > 0 ? ` + ${fmtResto}` : ""}`;
}

/**
 * Master que corresponde a una carga según la dosificación (gramos de master
 * por kg de base). Ej.: 100 kg de 2240P × 15 g/kg = 1,5 kg de master.
 */
export function masterParaBase(kgBase: number, gPorKg: number): number {
  return Math.round(kgBase * gPorKg) / 1000;
}
