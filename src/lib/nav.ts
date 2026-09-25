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
import { ROLES_GESTION } from "@/lib/auth/permisos";

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

export type ItemNav = { href: string; label: string };

const NAV_BASE: ItemNav[] = [{ href: "/pedidos", label: "Pedidos" }];
const NAV_GESTION: ItemNav[] = [
  { href: "/pedidos", label: "Pedidos" },
  { href: "/catalogo", label: "Catálogo" },
  { href: "/clientes", label: "Clientes" },
];

export const NAV_POR_ROL: Record<Rol, ItemNav[]> = Object.fromEntries(
  (Object.keys(ROL_LABEL) as Rol[]).map((r) => [r, ROLES_GESTION.includes(r) ? NAV_GESTION : NAV_BASE]),
) as Record<Rol, ItemNav[]>;

export const HOME_POR_ROL: Record<Rol, string> = Object.fromEntries(
  (Object.keys(NAV_POR_ROL) as Rol[]).map((r) => [r, "/pedidos"]),
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
