import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { SECCIONES_ADMIN } from "@/lib/admin-secciones";
import { fmtFechaHora } from "@/lib/format";

/** Cada sección vuelve a chequear su permiso: el menú oculta, esto protege. */
export async function exigirSeccion(href: string) {
  const usuario = await getUsuarioActual();
  const seccion = SECCIONES_ADMIN.find((s) => s.href === href);
  if (!seccion || !seccion.permiso(usuario.rol)) redirect("/admin");
  return usuario;
}

export function Aviso({ ok, error }: { ok?: string; error?: string }) {
  if (error) {
    return (
      <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">
        {error}
      </div>
    );
  }
  if (ok) {
    return (
      <div className="rounded-md bg-[var(--estado-ok-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-ok-fg)]">{ok}</div>
    );
  }
  return null;
}

export function UltimaModificacion({ valor }: { valor: { fecha: Date; usuarioNombre: string } | null }) {
  if (!valor) return <span className="text-foreground-muted">—</span>;
  return (
    <span className="text-xs text-foreground-muted">
      {fmtFechaHora(valor.fecha)}
      <br />
      {valor.usuarioNombre}
    </span>
  );
}

export const TH = "px-3 py-2.5";
export const TD = "px-3 py-2.5 align-top";
export const BOTON = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90";
export const BOTON_SECUNDARIO = "text-sm font-medium text-accent hover:underline";
