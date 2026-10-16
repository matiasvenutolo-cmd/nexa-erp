import Image from "next/image";
import Link from "next/link";
import { getUsuarioActual } from "@/lib/session";
import { HOME_POR_ROL, NAV_POR_ROL, ROL_LABEL, ROLES_CON_AVISOS } from "@/lib/nav";
import { contarAvisosPendientes } from "@/lib/data/avisos";
import { cerrarSesionAction } from "@/app/actions/sesion";
import { SidebarNav, NavMovil } from "@/components/sidebar-nav";
import { puedeElegirVistaPrecios, puedeInformarError } from "@/lib/auth/permisos";
import { InformarError } from "@/components/informar-error";
import { vistaCompleta } from "@/lib/vista";
import { cambiarVistaAction } from "@/app/actions/vista";

/**
 * Marco de la aplicación con la misma identidad que Nexa Soluciones: franja de
 * marca azul/naranja, logo en caja blanca, título en azul. En computadora el
 * menú va al costado ("siempre es más cómodo el menú al costado", minuta
 * 26-28/09); en el celular, una barra superior con el menú desplegable. El
 * operario no tiene menú: su pantalla es una sola.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const usuario = await getUsuarioActual();
  const nav = NAV_POR_ROL[usuario.rol];
  const contadores: Record<string, number> = ROLES_CON_AVISOS.includes(usuario.rol)
    ? { "/avisos": await contarAvisosPendientes(usuario.rol) }
    : {};
  const eligeVista = puedeElegirVistaPrecios(usuario.rol);
  const completa = eligeVista && (await vistaCompleta());
  const soloUnaPantalla = nav.length <= 1;

  const vista = eligeVista && (
    <form action={cambiarVistaAction}>
      <button
        type="submit"
        title="El Supervisor puede trabajar sin precios o con la vista completa"
        className={`btn btn-sm w-full ${completa ? "btn-azul" : "btn-outline"}`}
      >
        {completa ? "Vista completa (con precios)" : "Vista sin precios"}
      </button>
    </form>
  );
  const salir = (
    <form action={cerrarSesionAction}>
      <button type="submit" className="btn btn-ghost btn-sm">
        Cerrar sesión
      </button>
    </form>
  );
  const marca = (
    <Link href={HOME_POR_ROL[usuario.rol]} className="flex min-w-0 items-center gap-3">
      <span className="flex shrink-0 items-center rounded-lg border border-[rgba(0,32,148,0.1)] bg-white px-2 py-1 shadow-sm">
        <Image src="/nexa-logo.png" alt="NEXA" width={52} height={34} priority className="h-[30px] w-auto" />
      </span>
      <span className="min-w-0">
        <span className="block whitespace-nowrap font-[family-name:var(--font-display)] text-[1rem] font-semibold leading-tight tracking-tight text-brand-azul">
          Producción y stock
        </span>
        <span className="block truncate text-[11px] font-medium text-foreground-muted">Pisos encastrables</span>
      </span>
    </Link>
  );
  const persona = (
    <div className="flex items-center gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-brand-azul">
        {usuario.nombre.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold">{usuario.nombre}</span>
        <span className="block text-xs text-foreground-muted">{ROL_LABEL[usuario.rol]}</span>
      </span>
    </div>
  );

  return (
    <div className="min-h-screen">
      <div className="brand-stripe print:hidden" />
      <div className={`flex min-h-[calc(100vh-3px)] flex-col ${soloUnaPantalla ? "" : "md:flex-row"}`}>
        {!soloUnaPantalla && (
          <aside className="sticky top-0 hidden h-[calc(100vh-3px)] w-60 shrink-0 flex-col border-r border-border bg-white/90 p-4 backdrop-blur print:hidden md:flex">
            <div className="mb-5">{marca}</div>
            <SidebarNav nav={nav} contadores={contadores} />
            <div className="mt-auto flex flex-col gap-2 border-t border-border pt-4">
              {persona}
              {vista}
              {puedeInformarError(usuario.rol) && <InformarError />}
              {salir}
            </div>
          </aside>
        )}

        <header
          className={`sticky top-0 z-30 border-b border-[rgba(0,32,148,0.12)] bg-white/90 backdrop-blur print:hidden ${soloUnaPantalla ? "" : "md:hidden"}`}
        >
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-2.5">
            {marca}
            <div className="flex items-center gap-1">
              {soloUnaPantalla ? (
                <>
                  <span className="hidden text-sm font-semibold sm:inline">{usuario.nombre}</span>
                  {salir}
                </>
              ) : (
                <NavMovil nav={nav} contadores={contadores} pie={<div className="flex flex-col gap-2">{persona}{vista}{puedeInformarError(usuario.rol) && <InformarError />}{salir}</div>} />
              )}
            </div>
          </div>
        </header>

        <main className="w-full min-w-0 flex-1 px-4 py-5 md:px-8 md:py-7">
          <div className="mx-auto max-w-6xl">
            {children}
            {soloUnaPantalla && puedeInformarError(usuario.rol) && (
              <div className="mx-auto mt-6 max-w-xl">
                <InformarError />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
