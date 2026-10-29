/**
 * Orden natural de códigos de materia prima: primero los numéricos de menor a
 * mayor (3, 4, 6, 19, 31… 410) y después los de proveedor por letra y número
 * (A3, A4… A14, B1… B16, P1… P15). El orden de texto ponía «19» antes que «3».
 * Función pura.
 */
export function compararCodigoMp(a: string, b: string): number {
  const partes = (c: string) => {
    const m = /^([A-Za-z]*)0*(\d+)/.exec(c.trim());
    return m ? { letra: m[1].toUpperCase(), n: Number(m[2]) } : { letra: c.trim().toUpperCase(), n: Number.POSITIVE_INFINITY };
  };
  const x = partes(a);
  const y = partes(b);
  if (x.letra !== y.letra) return x.letra === "" ? -1 : y.letra === "" ? 1 : x.letra.localeCompare(y.letra);
  return x.n - y.n || a.localeCompare(b);
}

/** Orden de los grupos como en la planilla del cliente: virgen, master,
 *  molienda, sobrante y muestras. */
const TIPOS = ["VIRGEN", "MASTER", "MOLIENDA", "SOBRANTE", "MUESTRA"];
export function ordenTipoMp(tipo: string): number {
  const i = TIPOS.indexOf(tipo);
  return i < 0 ? TIPOS.length : i;
}
