/**
 * Inyectoras de la planta. Son las máquinas que registra la planilla real
 * "CARGA INYECTORAS - NEXA y CP" (una hoja por máquina, de la 1 a la 8); no se
 * agregan máquinas que no existen.
 *
 * Regla del cliente: las baldosas (pisos) se inyectan sí o sí en la 8; los
 * accesorios (bordes, esquineros, rampas) pueden ir a otra inyectora — en el
 * histórico de NEXA aparecen en la 6.
 */
export const INYECTORAS = ["1", "2", "3", "4", "5", "6", "7", "8"] as const;
export const INYECTORA_BALDOSAS = "8";

export function etiquetaInyectora(valor: string): string {
  return /^\d+$/.test(valor) ? `Inyectora ${valor}` : valor;
}

/** Valida y normaliza la inyectora de un ciclo según el tipo de producto. */
export function resolverInyectora(esAccesorio: boolean, valor: string | null | undefined): { inyectora: string } | { error: string } {
  const v = String(valor ?? "").replace(/inyectora/i, "").trim();
  if (!esAccesorio) {
    if (v && v !== INYECTORA_BALDOSAS) return { error: `Las baldosas se producen sólo en la inyectora ${INYECTORA_BALDOSAS}.` };
    return { inyectora: INYECTORA_BALDOSAS };
  }
  if (!v) return { error: "Elegí la inyectora del accesorio." };
  if (!(INYECTORAS as readonly string[]).includes(v)) return { error: `La inyectora ${v} no existe en la planta (1 a 8).` };
  return { inyectora: v };
}
