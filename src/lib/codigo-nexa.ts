/**
 * Código de barras NEXA de cada caja (formato corto acordado en la reunión del
 * 10/11/2026, etiquetas del 12/11):
 *
 *   001B-6000172-00022
 *   │    │       └ 5 dígitos: piezas de la caja
 *   │    └ 7 dígitos: último dígito del año + 6 de partida
 *   └ código de producto NEXA: 3 números + inicial del proveedor del master
 *
 * Producto y color ya no van: el «001B» identifica «Rejilla único Negro».
 * Al cambiar el año cambia el dígito y la partida vuelve a empezar.
 */

/** 2026, partida 165 → "6000165". */
export function partidaNexa(anio: number, numero: number): string {
  return `${anio % 10}${String(numero).padStart(6, "0")}`;
}

/** Primer bloque del código del producto: «001B-PR-NE» → «001B». */
export function codigoProductoNexa(codigoProducto: string): string {
  return codigoProducto.trim().toUpperCase().split("-")[0];
}

export function codigoEtiquetaCaja(codigoProducto: string, anio: number, numeroPartida: number, piezas: number): string {
  return `${codigoProductoNexa(codigoProducto)}-${partidaNexa(anio, numeroPartida)}-${String(piezas).padStart(5, "0")}`;
}

/** Separa un código leído: «001B-6000172-00022» → producto, partida y piezas. */
export function leerCodigoCaja(codigo: string): { producto: string; partida: string; piezas: number } | null {
  const m = /^([0-9]{3}[A-Z])-(\d{7})-(\d{5})$/.exec(codigo.trim().toUpperCase());
  return m ? { producto: m[1], partida: m[2], piezas: Number(m[3]) } : null;
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
