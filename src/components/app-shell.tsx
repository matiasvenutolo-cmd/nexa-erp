import Link from "next/link";
import Image from "next/image";
import { getUsuarioActual } from "@/lib/session";
import { NAV_POR_ROL, ROL_LABEL } from "@/lib/nav";
import { cerrarSesionAction } from "@/app/actions/sesion";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const usuario = await getUsuarioActual();
  const nav = NAV_POR_ROL[usuario.rol];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface print:hidden">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <Image src="/nexa-logo.png" alt="NEXA" width={84} height={55} priority />
          </div>
          <div className="flex items-center gap-2">
            <span className="badge-estado hidden bg-surface-muted text-foreground-muted sm:inline-flex">
              {ROL_LABEL[usuario.rol]}
            </span>
            <span className="hidden text-sm font-medium sm:inline">{usuario.nombre}</span>
            <form action={cerrarSesionAction}>
              <button
                type="submit"
                className="rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground-muted hover:text-foreground"
              >
                Cerrar sesión
              </button>
            </form>
          </div>
        </div>
        {nav.length > 1 && (
          <nav className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-4">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium text-foreground-muted hover:bg-surface-muted hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
