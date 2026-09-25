/**
 * Navegación y control de acceso por rol.
 *
 * En R1 el único módulo construido es Pedidos, y el mockup del cliente ya
 * había decidido algo que se mantiene: "Pedidos lo siguen viendo todos los
 * roles". Por eso el menú es el mismo para los 10 roles por ahora — regla 7
 * de docs/03-plan-release-1.md, no agregar secciones que ningún release
 * todavía resuelve. Cuando entre R2 (Stock) este archivo va a diferenciar
 * de verdad por rol.
 */
import type { usuario } from "@/lib/db/schema";

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

export const NAV_POR_ROL: Record<Rol, ItemNav[]> = {
  GERENCIA: NAV_BASE,
  SUPERVISOR: NAV_BASE,
  ADMINISTRACION: NAV_BASE,
  ENCARGADO: NAV_BASE,
  MATERIA_PRIMA: NAV_BASE,
  RETIROS_MP: NAV_BASE,
  MATRICES: NAV_BASE,
  MOLINO: NAV_BASE,
  DESPACHO: NAV_BASE,
  OPERARIO: NAV_BASE,
};

export const HOME_POR_ROL: Record<Rol, string> = Object.fromEntries(
  (Object.keys(NAV_POR_ROL) as Rol[]).map((r) => [r, "/pedidos"]),
) as Record<Rol, string>;

/** Rutas accesibles por rol, para el control de acceso real de src/proxy.ts.
 *  Se deriva de NAV_POR_ROL por prefijo, así una sola lista gobierna menú y
 *  autorización — ver el mismo patrón en reiner-erp. */
export function rutaPermitida(rol: Rol, pathname: string): boolean {
  return NAV_POR_ROL[rol].some(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
}
