import Link from "next/link";
import { redirect } from "next/navigation";
import { listarAvisos } from "@/lib/data/avisos";
import { marcarAvisoProcesadoAction, marcarAvisoVistoAction } from "@/app/actions/avisos";
import { getUsuarioActual } from "@/lib/session";
import { ROLES_CON_AVISOS } from "@/lib/nav";
import { fmtFechaHora } from "@/lib/format";

const TIPO_LABEL = {
  PEDIDO_LISTO: "Pedido listo para despachar",
  RECLAMO_NUEVO: "Reclamo nuevo",
  INFORME_RECLAMO: "Informe de reclamo",
} as const;

export default async function AvisosPage({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!ROLES_CON_AVISOS.includes(usuario.rol)) redirect("/tablero");
  const sp = await searchParams;
  const todos = sp.todos === "1";
  const avisos = await listarAvisos(usuario.rol, { incluirProcesados: todos });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-brand-azul-oscuro">Avisos</h1>
        <Link href={todos ? "/avisos" : "/avisos?todos=1"} className="text-sm font-medium text-accent hover:underline">
          {todos ? "Ver sólo pendientes" : "Ver también los procesados"}
        </Link>
      </div>
      {avisos.length === 0 && <p className="text-sm text-foreground-muted">No hay avisos {todos ? "" : "pendientes"}.</p>}
      <ul className="space-y-3">
        {avisos.map((a) => (
          <li
            key={a.id}
            className={`rounded-lg border bg-surface p-4 text-sm ${a.procesadoEn ? "border-border opacity-70" : a.vistoEn ? "border-border" : "border-accent"}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{TIPO_LABEL[a.tipo]}</span>
              {!a.vistoEn && <span className="badge-estado badge-critico">Nuevo</span>}
              {a.procesadoEn && <span className="badge-estado badge-ok">Procesado</span>}
              <span className="text-xs text-foreground-muted">
                {fmtFechaHora(a.creadoEn)} · generado por {a.creadoPorNombre}
              </span>
            </div>
            <p className="mt-1">{a.mensaje}</p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              {a.pedidoId && (
                <Link href={`/pedidos/${a.pedidoId}`} className="font-medium text-accent hover:underline">
                  Ver pedido #{a.pedidoId}
                </Link>
              )}
              {a.reclamoId && (
                <Link href={`/reclamos/${a.reclamoId}`} className="font-medium text-accent hover:underline">
                  Ver reclamo #{a.reclamoId}
                </Link>
              )}
              {!a.vistoEn && (
                <form action={marcarAvisoVistoAction.bind(null, a.id)}>
                  <button type="submit" className="text-foreground-muted hover:text-foreground">
                    Marcar visto
                  </button>
                </form>
              )}
              {!a.procesadoEn && (
                <form action={marcarAvisoProcesadoAction.bind(null, a.id)}>
                  <button type="submit" className="font-medium text-accent hover:underline">
                    Marcar procesado
                  </button>
                </form>
              )}
              <span className="text-xs text-foreground-muted">
                {a.vistoEn && `Visto por ${a.vistoPorNombre} ${fmtFechaHora(a.vistoEn)}`}
                {a.procesadoEn && ` · procesado por ${a.procesadoPorNombre} ${fmtFechaHora(a.procesadoEn)}`}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
