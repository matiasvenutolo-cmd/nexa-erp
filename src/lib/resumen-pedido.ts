/**
 * Resumen de un pedido para Ventas, Administración y Fábrica: baldosas por
 * producto y color, accesorios por tipo y color, total de baldosas y
 * superficie. La superficie sale de los m² por pieza de cada producto; los
 * accesorios no suman m². Un piso sin superficie configurada se informa y el
 * total queda marcado como incompleto (no se estima).
 */
export type LineaResumen = {
  productoId: number | null;
  codigo: string | null;
  familia: "REJILLA" | "CIEGO" | null;
  tipo: "UNICO" | "TRAMA" | "MONEDA" | "BORDE" | "ESQUINERO" | "RAMPA" | null;
  esAccesorio: boolean | null;
  colorNombre: string | null;
  unidades: number;
  m2PorUnidad: number | null;
};

export type GrupoResumen = { etiqueta: string; unidades: number; m2: number | null };

const FAMILIA: Record<string, string> = { REJILLA: "Rejilla", CIEGO: "Ciego" };
const TIPO_PISO: Record<string, string> = { UNICO: "Piso Rejilla", TRAMA: "Piso Ciego Trama", MONEDA: "Piso Ciego Moneda" };
const TIPO_ACC: Record<string, string> = { ESQUINERO: "Esquineros", RAMPA: "Rampas", BORDE: "Bordes" };

export function resumirPedido(lineas: LineaResumen[]) {
  const baldosas = new Map<string, GrupoResumen>();
  const accesorios = new Map<string, GrupoResumen>();
  const sinSuperficie = new Set<string>();
  let sinProducto = 0;
  let m2Total = 0;
  for (const l of lineas) {
    if (l.productoId == null || l.tipo == null) {
      sinProducto += 1;
      continue;
    }
    const color = l.colorNombre ?? "sin color";
    if (!l.esAccesorio) {
      const etiqueta = `${TIPO_PISO[l.tipo] ?? `Piso ${FAMILIA[l.familia ?? ""] ?? ""}`}, ${color}`;
      const g = baldosas.get(etiqueta) ?? { etiqueta, unidades: 0, m2: 0 };
      g.unidades += l.unidades;
      if (l.m2PorUnidad != null && l.m2PorUnidad > 0) {
        const m2 = l.unidades * l.m2PorUnidad;
        g.m2 = g.m2 == null ? null : g.m2 + m2;
        m2Total += m2;
      } else {
        g.m2 = null;
        sinSuperficie.add(l.codigo ?? etiqueta);
      }
      baldosas.set(etiqueta, g);
    } else {
      const etiqueta = `${TIPO_ACC[l.tipo] ?? l.tipo} (${FAMILIA[l.familia ?? ""] ?? ""}), ${color}`;
      const g = accesorios.get(etiqueta) ?? { etiqueta, unidades: 0, m2: null };
      g.unidades += l.unidades;
      accesorios.set(etiqueta, g);
    }
  }
  const totalBaldosas = [...baldosas.values()].reduce((t, g) => t + g.unidades, 0);
  return {
    baldosas: [...baldosas.values()],
    accesorios: [...accesorios.values()],
    totalBaldosas,
    totalAccesorios: [...accesorios.values()].reduce((t, g) => t + g.unidades, 0),
    m2Total: Math.round(m2Total * 100) / 100,
    /** Pisos sin m² por pieza: el total de superficie no los incluye. */
    sinSuperficie: [...sinSuperficie],
    sinProducto,
  };
}
