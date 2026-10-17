/**
 * Nombre del tipo de producto para mostrar. En rejilla el piso "único" se
 * llama «Rejilla» (listado de mejoras); el código oficial no cambia.
 */
const TIPO: Record<string, string> = { UNICO: "Único", TRAMA: "Trama", MONEDA: "Moneda", BORDE: "Borde", ESQUINERO: "Esquinero", RAMPA: "Rampa" };

export function etiquetaTipo(familia: string, tipo: string): string {
  if (tipo === "UNICO") return familia === "REJILLA" ? "Rejilla" : "Ciego";
  return TIPO[tipo] ?? tipo;
}
