import Image from "next/image";
import Link from "next/link";
import { getUsuarioActual } from "@/lib/session";
import { NAV_POR_ROL, ROL_LABEL, ROLES_CON_AVISOS } from "@/lib/nav";
import { contarAvisosPendientes } from "@/lib/data/avisos";
import { cerrarSesionAction } from "@/app/actions/sesion";
import { SidebarNav } from "@/components/sidebar-nav";
import { puedeElegirVistaPrecios } from "@/lib/auth/permisos";
import { vistaCompleta } from "@/lib/vista";
import { cambiarVistaAction } from "@/app/actions/vista";

/**
 * Menú lateral en desktop — "siempre es más cómodo el menú al costado, como
 * tenía el sistema viejo" (el cliente lo valoró explícitamente, minuta
 * 26-28/09). En mobile el sidebar no entra sin comerse media pantalla, así
 * que ahí se mantiene una barra superior simple con los mismos ítems.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const usuario = await getUsuarioActual();
  const nav = NAV_POR_ROL[usuario.rol];
  const contadores: Record<string, number> = ROLES_CON_AVISOS.includes(usuario.rol)
    ? { "/avisos": await contarAvisosPendientes(usuario.rol) }
    : {};

  const eligeVista = puedeElegirVistaPrecios(usuario.rol);
  const completa = eligeVista && (await vistaCompleta());

  const usuarioInfo = (
    <>
      <span className="badge-estado bg-surface-muted text-foreground-muted">{ROL_LABEL[usuario.rol]}</span>
      {eligeVista && (
        <form action={cambiarVistaAction}>
          <button
            type="submit"
            title="El Supervisor puede trabajar sin precios o con la vista completa"
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${completa ? "bg-accent text-accent-foreground" : "bg-surface-muted text-foreground-muted"}`}
          >
            {completa ? "Vista completa (con precios)" : "Vista sin precios"}
          </button>
        </form>
      )}
      <span className="text-sm font-medium">{usuario.nombre}</span>
      <form action={cerrarSesionAction}>
        <button
          type="submit"
          className="rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground-muted hover:text-foreground"
        >
          Cerrar sesión
        </button>
      </form>
    </>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Sidebar — desktop */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface p-4 print:hidden md:flex">
        <Image src="/nexa-logo.png" alt="NEXA" width={112} height={73} priority className="mb-6" />
        <SidebarNav nav={nav} contadores={contadores} />
        <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">{usuarioInfo}</div>
      </aside>

      {/* Barra superior — mobile */}
      <header className="border-b border-border bg-surface print:hidden md:hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <Image src="/nexa-logo.png" alt="NEXA" width={72} height={47} priority />
          <div className="flex items-center gap-2">{usuarioInfo}</div>
        </div>
        {nav.length > 1 && (
          <nav className="flex gap-1 overflow-x-auto px-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-muted hover:text-foreground"
              >
                {item.label}
                {contadores[item.href] ? ` (${contadores[item.href]})` : ""}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="w-full flex-1 overflow-x-auto px-4 py-6 md:px-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
