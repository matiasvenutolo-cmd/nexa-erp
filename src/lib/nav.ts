/**
 * Navegación y control de acceso por rol.
 *
 * Minuta del 15/10/2026: el menú se organiza en tres áreas (Ventas, Fábrica,
 * Administración) y cada usuario ve sólo lo que su tarea necesita:
 *  - el operario de planta entra a "Mi turno" (pantalla de celular) y nada más;
 *  - Materia prima ve su stock, "sin pedidos ni producción";
 *  - Ventas, Encargado, Supervisión y Gerencia ven lo de siempre según sus
 *    permisos (los de src/lib/auth/permisos.ts, que no cambian por el menú).
 * El acceso real se controla en src/proxy.ts con `rutaPermitida`.
 */
import type { usuario } from "@/lib/db/schema";
import {
  ROLES_GESTION,
  puedeCargarProduccion,
  puedeOperarTaller,
  puedeVerCompras,
  puedeVerMateriaPrima,
  puedeVerMatrices,
  puedeVerMolino,
  puedeVerProduccion,
  puedeVerReclamos,
  puedeVerTrazabilidad,
  puedeVerVentas,
} from "@/lib/auth/permisos";
import { SECCIONES_ADMIN } from "@/lib/admin-secciones";

type Rol = (typeof usuario.$inferSelect)["rol"];

export const ROL_LABEL: Record<Rol, string> = {
  GERENCIA: "Gerencia",
  SUPERVISOR: "Supervisor",
  ADMINISTRACION: "Administración",
  ENCARGADO: "Encargado",
  MATERIA_PRIMA: "Materia prima",
  RETIROS_MP: "Retiros de MP",
  MATRICES: "Matrices",
  MOLINO: "Molino",
  DESPACHO: "Despacho",
  OPERARIO: "Operario",
  COMPRAS: "Compras",
  GERENCIA_CONSULTA: "Gerencia (consulta)",
};

/** Áreas de negocio del menú. */
export type SeccionNav = "Ventas" | "Fábrica" | "Administración";

export type ItemNav = { href: string; label: string; seccion?: SeccionNav };

/** Roles que reciben avisos: ventas (pedido listo), supervisión y gerencia
 *  (reclamos, errores informados para corregir). */
export const ROLES_CON_AVISOS: readonly Rol[] = ["ADMINISTRACION", "SUPERVISOR", "GERENCIA"];

/** Roles que trabajan en la planta y no necesitan el tablero ni los pedidos. */
const SOLO_SU_PANTALLA: readonly Rol[] = ["OPERARIO", "MATERIA_PRIMA", "MATRICES", "MOLINO", "COMPRAS"];

/** Secciones de Administración: Usuarios, Parámetros, Configuración (stock,
 *  master, recetas, productos, colores) e Historial de cambios. */
function itemsAdministracion(r: Rol): ItemNav[] {
  const ver = (href: string) => SECCIONES_ADMIN.some((s) => s.href === href && s.permiso(r));
  const config = SECCIONES_ADMIN.find((s) => s.grupo === "config" && s.permiso(r));
  const items: (ItemNav | false)[] = [
    ver("/admin/usuarios") && { href: "/admin/usuarios", label: "Usuarios", seccion: "Administración" },
    ver("/admin/parametros") && { href: "/admin/parametros", label: "Parámetros", seccion: "Administración" },
    config != null && { href: config.href, label: "Configuración", seccion: "Administración" },
    ver("/admin/historial") && { href: "/admin/historial", label: "Historial de cambios", seccion: "Administración" },
  ];
  return items.filter((i): i is ItemNav => Boolean(i));
}

export const NAV_POR_ROL: Record<Rol, ItemNav[]> = Object.fromEntries(
  (Object.keys(ROL_LABEL) as Rol[]).map((r) => {
    const gestion = puedeVerVentas(r);
    const planta = SOLO_SU_PANTALLA.includes(r);
    const items: (ItemNav | false)[] = [
      r === "OPERARIO" && { href: "/taller", label: "Mi turno" },
      !planta && { href: "/tablero", label: "Inicio" },
      ROLES_CON_AVISOS.includes(r) && { href: "/avisos", label: "Avisos" },
      !planta && { href: "/pedidos", label: "Pedidos", seccion: "Ventas" },
      gestion && { href: "/catalogo", label: "Stock de productos", seccion: "Ventas" },
      gestion && { href: "/clientes", label: "Clientes", seccion: "Ventas" },
      puedeVerReclamos(r) && { href: "/reclamos", label: "Reclamos", seccion: "Ventas" },
      r !== "OPERARIO" && puedeVerProduccion(r) && { href: "/produccion", label: "Producción", seccion: "Fábrica" },
      puedeVerMateriaPrima(r) && { href: "/materia-prima", label: "Materia prima", seccion: "Fábrica" },
      puedeVerTrazabilidad(r) && { href: "/trazabilidad", label: "Trazabilidad", seccion: "Fábrica" },
      puedeVerCompras(r) && { href: "/compras", label: "Compras", seccion: "Fábrica" },
      puedeVerMatrices(r) && { href: "/matrices", label: "Matrices", seccion: "Fábrica" },
      puedeVerMolino(r) && { href: "/molino", label: "Molino", seccion: "Fábrica" },
      ...itemsAdministracion(r),
    ];
    return [r, items.filter((i): i is ItemNav => Boolean(i))];
  }),
) as Record<Rol, ItemNav[]>;

/** Pantalla de entrada de cada rol: lo primero que tiene que hacer. */
export const HOME_POR_ROL: Record<Rol, string> = Object.fromEntries(
  (Object.keys(NAV_POR_ROL) as Rol[]).map((r) => {
    if (r === "OPERARIO") return [r, "/taller"];
    if (r === "MATERIA_PRIMA") return [r, "/materia-prima"];
    if (r === "ENCARGADO") return [r, "/produccion"];
    if (r === "COMPRAS") return [r, "/compras"];
    if (r === "MATRICES") return [r, "/matrices"];
    if (r === "MOLINO") return [r, "/molino"];
    return [r, "/tablero"];
  }),
) as Record<Rol, string>;

/**
 * Rutas accesibles por rol, para el control de acceso real de src/proxy.ts.
 * Se deriva de NAV_POR_ROL por prefijo, con excepciones explícitas:
 *  - "/pedidos/nuevo" sólo para quien puede crear pedidos;
 *  - "/produccion/nuevo" sólo para quien inicia producciones;
 *  - "/taller" también para quien coordina la planta (ve lo mismo que el operario);
 *  - "/admin/*": la sección la vuelve a chequear el layout del panel.
 */
export function rutaPermitida(rol: Rol, pathname: string): boolean {
  const bajo = (base: string) => pathname === base || pathname.startsWith(`${base}/`);
  if (bajo("/pedidos/nuevo")) return ROLES_GESTION.includes(rol);
  if (bajo("/produccion/nuevo")) return puedeCargarProduccion(rol);
  if (bajo("/taller")) return puedeOperarTaller(rol);
  if (bajo("/admin")) return NAV_POR_ROL[rol].some((i) => i.href.startsWith("/admin"));
  return NAV_POR_ROL[rol].some((item) => bajo(item.href));
}
