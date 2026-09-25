/**
 * Reglas de permisos por rol — traducidas literalmente de la reunión del
 * 16/09/2026 (docs/01-analisis.md §3.10), no inventadas:
 *
 *   "el encargado de pisos tiene que ver todo menos precios... supervisor
 *   soy yo, también, todo menos precios... y de supervisor para arriba,
 *   ventas y gerencia, ellos pueden ver todo."
 *
 * Es decir: sólo GERENCIA y ADMINISTRACION (ventas — Alejandra) ven precios.
 * Todos los demás roles, de supervisor para abajo, no. Vive en una función,
 * no en una columna del usuario (`schema.ts` lo aclara en el comentario de
 * `usuario`), para que la regla no pueda quedar desincronizada fila por fila.
 */
import type { usuario } from "@/lib/db/schema";

type Rol = (typeof usuario.$inferSelect)["rol"];

const ROLES_CON_PRECIOS: readonly Rol[] = ["GERENCIA", "ADMINISTRACION"];

export function puedeVerPrecios(rol: Rol): boolean {
  return ROLES_CON_PRECIOS.includes(rol);
}

/**
 * Quién puede armar/coordinar pedidos — no sólo verlos. Es la misma lista
 * que gobierna el menú de Catálogo y Clientes en src/lib/nav.ts (single
 * source of truth: `rol.ts` compone su navegación a partir de esto).
 *
 * Ver "Pedidos" es de todos los roles (así lo decidió el propio cliente en
 * el mockup); CREAR uno es una tarea de venta/coordinación. Sin esta
 * distinción, /pedidos/nuevo quedaba alcanzable por URL directa para
 * cualquier rol, sólo por ser una subruta de "/pedidos" — el mismo tipo de
 * hueco de acceso que REINER documentó y cerró (docs/01-analisis.md
 * hallazgo 1: ninguna URL debe quedar sin protección real).
 */
export const ROLES_GESTION: readonly Rol[] = ["GERENCIA", "SUPERVISOR", "ADMINISTRACION", "ENCARGADO"];

export function puedeCrearPedido(rol: Rol): boolean {
  return ROLES_GESTION.includes(rol);
}
