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

const ACENTOS: Record<string, string> = { copolimero: "Copolímero", homopolimero: "Homopolímero" };
const titulo = (p: string) => ACENTOS[p.toLowerCase()] ?? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();

/**
 * Nombre corto para la planta (Cambios en Producción, nov. 2026): sin código,
 * sin números de proveedor ni aclaraciones. «31-COPOLIMERO 2240 P» →
 * «Copolímero»; «B10-Master Gris Oscuro nor 108900 (gris claro catalogo)» →
 * «Master Gris Oscuro Nor». En la oficina se sigue viendo el nombre completo.
 */
export function nombreCortoMp(nombre: string): string {
  const sinCodigo = nombre.replace(/^\s*[A-Za-z]*\d+\s*-?\s*/, "").replace(/\(.*?\)/g, " ");
  const palabras: string[] = [];
  for (const p of sinCodigo.split(/\s+/).filter(Boolean)) {
    if (/\d|:/.test(p)) {
      // «negro991333»: lo que va antes del número es parte del nombre.
      const antes = p.split(/\d/)[0].replace(/[:\W]+$/, "");
      if (antes && !/^cod$/i.test(antes)) palabras.push(antes);
      break;
    }
    if (/^cod$/i.test(p)) break;
    palabras.push(p);
  }
  const corto = palabras.map(titulo).join(" ").trim();
  return corto || nombre.trim();
}
