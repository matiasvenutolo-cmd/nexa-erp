import type { usuario } from "@/lib/db/schema";
import {
  puedeAdministrarUsuarios,
  puedeEditarMinMax,
  puedeEditarParametrosProduccion,
  puedeGestionarColores,
  puedeVerPanelAdmin,
} from "@/lib/auth/permisos";

type Rol = (typeof usuario.$inferSelect)["rol"];

/** Secciones del Panel Admin. Cada rol ve sólo las que puede editar
 *  (regla 7: no mostrar lo que su tarea no usa); el historial lo ven todos. */
export const SECCIONES_ADMIN: { href: string; label: string; permiso: (rol: Rol) => boolean }[] = [
  { href: "/admin/stock", label: "Stock", permiso: puedeEditarMinMax },
  { href: "/admin/master", label: "Master", permiso: puedeEditarParametrosProduccion },
  { href: "/admin/productos", label: "Productos", permiso: puedeEditarParametrosProduccion },
  { href: "/admin/colores", label: "Colores", permiso: puedeGestionarColores },
  { href: "/admin/parametros", label: "Parámetros", permiso: puedeEditarParametrosProduccion },
  { href: "/admin/usuarios", label: "Usuarios", permiso: puedeAdministrarUsuarios },
  { href: "/admin/historial", label: "Historial", permiso: puedeVerPanelAdmin },
];
