"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Seccion = { href: string; label: string; grupo: "config" | "propia" };

const TITULO: Record<string, { titulo: string; texto: string }> = {
  config: {
    titulo: "Configuración",
    texto: "Recetas, mínimos, productos y colores. Cada cambio queda registrado con quién, cuándo y por qué.",
  },
  "/admin/parametros": { titulo: "Parámetros", texto: "Valores generales que usa el sistema en sus cálculos." },
  "/admin/usuarios": { titulo: "Usuarios", texto: "Quién entra al sistema y con qué rol." },
  "/admin/historial": { titulo: "Historial de cambios", texto: "Cada modificación con usuario, fecha, valor anterior, valor nuevo y motivo." },
};

/** Encabezado de Administración: en "Configuración" muestra sus pestañas; las
 *  demás secciones (Usuarios, Parámetros, Historial) son páginas propias. */
export function TabsAdmin({ secciones }: { secciones: Seccion[] }) {
  const pathname = usePathname();
  const actual = secciones.find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`));
  const enConfig = actual?.grupo === "config";
  const cab = enConfig ? TITULO.config : TITULO[actual?.href ?? ""] ?? TITULO.config;
  const tabs = secciones.filter((s) => s.grupo === "config");
  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>{cab.titulo}</h1>
          <p>{cab.texto}</p>
        </div>
      </div>
      {enConfig && tabs.length > 1 && (
        <nav className="flex gap-1 overflow-x-auto border-b border-border">
          {tabs.map((s) => {
            const activa = pathname === s.href || pathname.startsWith(`${s.href}/`);
            return (
              <Link
                key={s.href}
                href={s.href}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${
                  activa ? "border-accent text-accent" : "border-transparent text-foreground-muted hover:text-foreground"
                }`}
              >
                {s.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
