"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  Boxes,
  ClipboardList,
  Factory,
  History,
  LayoutDashboard,
  Menu,
  MessageSquareWarning,
  Package,
  Recycle,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Wrench,
  Smartphone,
  Users,
  UserCog,
  Waypoints,
  X,
} from "lucide-react";
import type { ItemNav } from "@/lib/nav";

const ICONO: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  "/taller": Smartphone,
  "/tablero": LayoutDashboard,
  "/pedidos": ClipboardList,
  "/catalogo": Boxes,
  "/clientes": Users,
  "/produccion": Factory,
  "/avisos": Bell,
  "/materia-prima": Package,
  "/trazabilidad": Waypoints,
  "/reclamos": MessageSquareWarning,
  "/compras": ShoppingCart,
  "/matrices": Wrench,
  "/molino": Recycle,
  "/admin/usuarios": UserCog,
  "/admin/parametros": SlidersHorizontal,
  "/admin/historial": History,
};

function activo(pathname: string, item: ItemNav, nav: ItemNav[]) {
  if (pathname === item.href || pathname.startsWith(`${item.href}/`)) return true;
  // "Configuración" apunta a su primera pestaña: queda activa en cualquiera de ellas.
  if (item.label === "Configuración" && pathname.startsWith("/admin")) {
    return !nav.some((o) => o !== item && o.href.startsWith("/admin") && (pathname === o.href || pathname.startsWith(`${o.href}/`)));
  }
  return false;
}

function Items({ nav, contadores, onNavegar }: { nav: ItemNav[]; contadores: Record<string, number>; onNavegar?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {nav.map((item, i) => {
        const on = activo(pathname, item, nav);
        const Icono = ICONO[item.href] ?? (item.href.startsWith("/admin") ? Settings : LayoutDashboard);
        const nuevaSeccion = item.seccion && item.seccion !== nav[i - 1]?.seccion;
        return (
          <div key={item.href + item.label}>
            {nuevaSeccion && (
              <div className="mb-1 mt-4 px-3 text-[11px] font-bold uppercase tracking-wider text-foreground-muted">{item.seccion}</div>
            )}
            <Link
              href={item.href}
              onClick={onNavegar}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                on ? "bg-accent-soft text-brand-azul" : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
              }`}
            >
              <Icono size={17} className={`shrink-0 ${on ? "text-accent" : ""}`} />
              {item.label}
              {(contadores[item.href] ?? 0) > 0 && (
                <span className="ml-auto rounded-full bg-[var(--estado-critico-bg)] px-1.5 text-xs font-bold text-[var(--estado-critico-fg)]">
                  {contadores[item.href]}
                </span>
              )}
            </Link>
          </div>
        );
      })}
    </nav>
  );
}

/** Menú lateral (computadora). */
export function SidebarNav({ nav, contadores = {} }: { nav: ItemNav[]; contadores?: Record<string, number> }) {
  return <Items nav={nav} contadores={contadores} />;
}

/** Menú desplegable (celular): mismo contenido que el lateral. */
export function NavMovil({ nav, contadores = {}, pie }: { nav: ItemNav[]; contadores?: Record<string, number>; pie?: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const pathname = usePathname();
  const total = Object.values(contadores).reduce((t, n) => t + n, 0);
  useEffect(() => {
    document.body.style.overflow = abierto ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [abierto]);
  const actual = nav.find((i) => activo(pathname, i, nav));
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setAbierto(true)} aria-label="Abrir menú">
        <Menu size={18} />
        <span className="max-w-[7rem] truncate">{actual?.label ?? "Menú"}</span>
        {total > 0 && <span className="rounded-full bg-[var(--estado-critico-bg)] px-1.5 text-xs font-bold text-[var(--estado-critico-fg)]">{total}</span>}
      </button>
      {abierto && (
        <div className="fixed inset-0 z-50 md:hidden">
          <button type="button" className="absolute inset-0 bg-[rgba(29,43,58,0.35)]" aria-label="Cerrar menú" onClick={() => setAbierto(false)} />
          <div className="absolute right-0 top-0 flex h-full w-[84%] max-w-xs flex-col overflow-y-auto bg-white p-4 shadow-xl">
            <div className="mb-2 flex justify-end">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAbierto(false)} aria-label="Cerrar menú">
                <X size={18} />
              </button>
            </div>
            <Items nav={nav} contadores={contadores} onNavegar={() => setAbierto(false)} />
            <div className="mt-auto border-t border-border pt-4">{pie}</div>
          </div>
        </div>
      )}
    </>
  );
}
