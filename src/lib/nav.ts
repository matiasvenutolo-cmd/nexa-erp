/**
 * Navegación y control de acceso por rol.
 *
 * El mockup del cliente ya había decidido algo que se mantiene: "Pedidos lo
 * siguen viendo todos los roles". Catálogo y Clientes son las pantallas de
 * apoyo para armar un pedido (docs/03-plan-release-1.md pasos 3 y 5) — las ve
 * quien puede cargar o coordinar pedidos: gerencia, supervisión,
 * administración (ventas) y el encargado. El resto de los roles (materia
 * prima, retiros, matrices, molino, despacho, operario) todavía sólo tiene
 * Pedidos — regla 7, no agregar secciones que su tarea de hoy no necesita.
 */
import type { usuario } from "@/lib/db/schema";
import {
  ROLES_GESTION,
  puedeCargarProduccion,
  puedeVerMateriaPrima,
  puedeVerPanelAdmin,
  puedeVerReclamos,
  puedeVerTrazabilidad,
} from "@/lib/auth/permisos";

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
};

/** Áreas de negocio del menú. Sólo agrupan la navegación: las rutas y los
 *  permisos de cada ítem son los mismos de siempre. */
export type SeccionNav = "Ventas" | "Fábrica" | "Administración";

export type ItemNav = { href: string; label: string; seccion?: SeccionNav };

/** Roles que reciben avisos: ventas (pedido listo), supervisor (reclamo nuevo)
 *  y gerencia (informes de reclamos; además ve todos). */
export const ROLES_CON_AVISOS: readonly Rol[] = ["ADMINISTRACION", "SUPERVISOR", "GERENCIA"];

// El tablero es la puerta de entrada para todos los roles (minuta 26-28/09:
// "el tablero debería ser la primera pantalla que aparece al ingresar").
// Pedidos lo ven todos los roles; Stock y Clientes, quien carga o coordina
// pedidos (ROLES_GESTION).
export const NAV_POR_ROL: Record<Rol, ItemNav[]> = Object.fromEntries(
  (Object.keys(ROL_LABEL) as Rol[]).map((r) => {
    const gestion = ROLES_GESTION.includes(r);
    const items: (ItemNav | false)[] = [
      { href: "/tablero", label: "Tablero" },
      ROLES_CON_AVISOS.includes(r) && { href: "/avisos", label: "Avisos" },
      { href: "/pedidos", label: "Pedidos", seccion: "Ventas" },
      gestion && { href: "/catalogo", label: "Stock / Productos", seccion: "Ventas" },
      gestion && { href: "/clientes", label: "Clientes", seccion: "Ventas" },
      puedeVerReclamos(r) && { href: "/reclamos", label: "Reclamos", seccion: "Ventas" },
      puedeCargarProduccion(r) && { href: "/produccion", label: "Producción", seccion: "Fábrica" },
      puedeVerMateriaPrima(r) && { href: "/materia-prima", label: "Materia prima", seccion: "Fábrica" },
      puedeVerTrazabilidad(r) && { href: "/trazabilidad", label: "Trazabilidad", seccion: "Fábrica" },
      puedeVerPanelAdmin(r) && { href: "/admin", label: "Panel Admin", seccion: "Administración" },
    ];
    return [r, items.filter((i): i is ItemNav => Boolean(i))];
  }),
) as Record<Rol, ItemNav[]>;

export const HOME_POR_ROL: Record<Rol, string> = Object.fromEntries(
  (Object.keys(NAV_POR_ROL) as Rol[]).map((r) => [r, "/tablero"]),
) as Record<Rol, string>;

/**
 * Rutas accesibles por rol, para el control de acceso real de src/proxy.ts.
 * Se deriva de NAV_POR_ROL por prefijo — mismo patrón que reiner-erp — CON
 * UNA EXCEPCIÓN: "/pedidos/nuevo" no se abre sólo por ser subruta de
 * "/pedidos". Ver a quién no ve el menú puedeCrearPedido() en
 * src/lib/auth/permisos.ts.
 */
export function rutaPermitida(rol: Rol, pathname: string): boolean {
  if (pathname === "/pedidos/nuevo" || pathname.startsWith("/pedidos/nuevo/")) {
    return ROLES_GESTION.includes(rol);
  }
  return NAV_POR_ROL[rol].some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}
