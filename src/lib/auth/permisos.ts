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
