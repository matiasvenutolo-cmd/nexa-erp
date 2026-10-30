/**
 * Código de barras NEXA de cada caja o palet (regla del cliente, 30/10/2026):
 *
 *   001B-RU-NE-6000165-00025
 *   │    │  │  │       └ 5 dígitos: piezas por caja o palet
 *   │    │  │  └ 7 dígitos: último dígito del año + 6 de partida
 *   │    │  └ color del producto (NE = negro)
 *   │    └ iniciales del producto (RU = rejilla único)
 *   └ código del producto + inicial del proveedor del master
 *
 * Los tres primeros bloques son el código de barras del producto de la lista
 * oficial del cliente. Al cambiar el año cambia el dígito y la partida vuelve
 * a empezar.
 */

/** 2026, partida 165 → "6000165". */
export function partidaNexa(anio: number, numero: number): string {
  return `${anio % 10}${String(numero).padStart(6, "0")}`;
}

export function codigoEtiquetaCaja(codigoProducto: string, anio: number, numeroPartida: number, piezas: number): string {
  return `${codigoProducto.trim().toUpperCase()}-${partidaNexa(anio, numeroPartida)}-${String(piezas).padStart(5, "0")}`;
}

/** Lee el número de partida escrito como «165» (del año en curso) o como los
 *  7 dígitos del código («6000165»: el año más reciente terminado en 6). */
export function leerPartidaNexa(texto: string, anioActual: number): { anio: number; numero: number } | null {
  const t = texto.trim();
  if (/^\d{7}$/.test(t)) {
    const digito = Number(t[0]);
    let anio = anioActual - ((anioActual % 10) - digito + 10) % 10;
    if (anio > anioActual) anio -= 10;
    return { anio, numero: Number(t.slice(1)) };
  }
  if (/^\d{1,6}$/.test(t)) return { anio: anioActual, numero: Number(t) };
  return null;
}
