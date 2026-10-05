"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function TabsAdmin({ secciones }: { secciones: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
      {secciones.map((s) => {
        const activa = pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link
            key={s.href}
            href={s.href}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
              activa ? "border-accent text-accent" : "border-transparent text-foreground-muted hover:text-foreground"
            }`}
          >
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
