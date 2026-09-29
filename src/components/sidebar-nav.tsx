"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ClipboardList, Boxes, Users, Factory } from "lucide-react";
import type { ItemNav } from "@/lib/nav";

const ICONO: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  "/tablero": LayoutDashboard,
  "/pedidos": ClipboardList,
  "/catalogo": Boxes,
  "/clientes": Users,
  "/produccion": Factory,
};

/** Menú lateral — "siempre es más cómodo el menú al costado" (el cliente lo
 *  valoró en el mockup viejo, docs/07-plan-release-2.md). Client component
 *  sólo para poder resaltar el ítem activo con `usePathname`. */
export function SidebarNav({ nav }: { nav: ItemNav[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5">
      {nav.map((item) => {
        const activo = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icono = ICONO[item.href];
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium ${
              activo ? "bg-accent-soft text-accent" : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
            }`}
          >
            {Icono && <Icono size={17} className="shrink-0" />}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
