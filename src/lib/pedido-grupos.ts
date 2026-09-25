/**
 * Los 9 grupos familia×tipo reales del catálogo (docs/01-analisis.md §3.1),
 * para el selector de la carga de pedido. "Borde" no tiene ningún SKU en el
 * catálogo importado todavía (docs/migracion-datos.md) — se deja igual como
 * opción, con color de texto libre, porque el cliente sí lo vende.
 */
import type { FilaProducto } from "@/lib/data/catalogo";

export type Familia = "REJILLA" | "CIEGO";
export type Tipo = "UNICO" | "TRAMA" | "MONEDA" | "BORDE" | "ESQUINERO" | "RAMPA";

export type Grupo = { key: string; familia: Familia; tipo: Tipo; label: string; esPiso: boolean };

export const GRUPOS: Grupo[] = [
  { key: "REJILLA-UNICO", familia: "REJILLA", tipo: "UNICO", label: "Piso Rejilla", esPiso: true },
  { key: "CIEGO-TRAMA", familia: "CIEGO", tipo: "TRAMA", label: "Piso Ciego Trama", esPiso: true },
  { key: "CIEGO-MONEDA", familia: "CIEGO", tipo: "MONEDA", label: "Piso Ciego Moneda", esPiso: true },
  { key: "REJILLA-ESQUINERO", familia: "REJILLA", tipo: "ESQUINERO", label: "Esquinero (Rejilla)", esPiso: false },
  { key: "REJILLA-RAMPA", familia: "REJILLA", tipo: "RAMPA", label: "Rampa (Rejilla)", esPiso: false },
  { key: "REJILLA-BORDE", familia: "REJILLA", tipo: "BORDE", label: "Borde (Rejilla)", esPiso: false },
  { key: "CIEGO-ESQUINERO", familia: "CIEGO", tipo: "ESQUINERO", label: "Esquinero (Ciego)", esPiso: false },
  { key: "CIEGO-RAMPA", familia: "CIEGO", tipo: "RAMPA", label: "Rampa (Ciego)", esPiso: false },
  { key: "CIEGO-BORDE", familia: "CIEGO", tipo: "BORDE", label: "Borde (Ciego)", esPiso: false },
];

export function grupoDeKey(key: string): Grupo | undefined {
  return GRUPOS.find((g) => g.key === key);
}

/** Colores con SKU real para un grupo, ordenados. Vacío para Borde (sin catálogo aún). */
export function coloresDeGrupo(productos: FilaProducto[], grupo: Grupo): FilaProducto[] {
  return productos
    .filter((p) => p.familia === grupo.familia && p.tipo === grupo.tipo)
    .sort((a, b) => a.colorNombre.localeCompare(b.colorNombre, "es"));
}
