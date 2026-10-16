import type { usuario } from "@/lib/db/schema";
import {
  puedeAdministrarOperarios,
  puedeEditarMinMax,
  puedeEditarParametrosProduccion,
  puedeEditarRecetas,
  puedeGestionarColores,
  puedeVerPanelAdmin,
} from "@/lib/auth/permisos";

type Rol = (typeof usuario.$inferSelect)["rol"];

/**
 * Secciones de Administración. Cada rol ve sólo las que puede editar (regla 7:
 * no mostrar lo que su tarea no usa); el historial lo ven todos los que entran.
 * `grupo: "config"` son las pestañas de "Configuración" del menú.
 */
export const SECCIONES_ADMIN: { href: string; label: string; grupo: "config" | "propia"; permiso: (rol: Rol) => boolean }[] = [
  { href: "/admin/recetas", label: "Recetas de carga", grupo: "config", permiso: puedeEditarRecetas },
  { href: "/admin/stock", label: "Mínimos y máximos", grupo: "config", permiso: puedeEditarMinMax },
  { href: "/admin/productos", label: "Productos", grupo: "config", permiso: puedeEditarParametrosProduccion },
  { href: "/admin/master", label: "Master (dosificación anterior)", grupo: "config", permiso: puedeEditarParametrosProduccion },
  { href: "/admin/colores", label: "Colores", grupo: "config", permiso: puedeGestionarColores },
  { href: "/admin/parametros", label: "Parámetros", grupo: "propia", permiso: puedeEditarParametrosProduccion },
  { href: "/admin/usuarios", label: "Usuarios", grupo: "propia", permiso: puedeAdministrarOperarios },
  { href: "/admin/historial", label: "Historial de cambios", grupo: "propia", permiso: puedeVerPanelAdmin },
];
