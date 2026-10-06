import Link from "next/link";
import { ESTADO_RECLAMO_LABEL, listarReclamos, MOTIVO_DEVOLUCION_LABEL, type EstadoReclamo } from "@/lib/data/reclamos";
import { getUsuarioActual } from "@/lib/session";
import { puedeCrearReclamo } from "@/lib/auth/permisos";
import { fmtDia } from "@/lib/format";

const FILTROS: { v?: EstadoReclamo; label: string }[] = [
  { label: "Todos" },
  { v: "ABIERTO", label: "Abiertos" },
  { v: "EN_ANALISIS", label: "En análisis" },
  { v: "CERRADO", label: "Cerrados" },
];

export default async function ReclamosPage({ searchParams }: { searchParams: Promise<{ estado?: EstadoReclamo }> }) {
  const usuario = await getUsuarioActual();
  const sp = await searchParams;
  const reclamos = await listarReclamos({ estado: sp.estado });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-brand-azul-oscuro">Reclamos</h1>
        {puedeCrearReclamo(usuario.rol) && (
          <Link href="/reclamos/nuevo" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">
            + Registrar reclamo
          </Link>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <Link
            key={f.label}
            href={f.v ? `/reclamos?estado=${f.v}` : "/reclamos"}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${sp.estado === f.v ? "bg-accent text-accent-foreground" : "bg-surface-muted text-foreground-muted"}`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Fecha</th>
                <th className="px-4 py-2.5">Cliente / pedido</th>
                <th className="px-4 py-2.5">Qué pasó</th>
                <th className="px-4 py-2.5">Causa</th>
                <th className="px-4 py-2.5">Estado</th>
              </tr>
            </thead>
            <tbody>
              {reclamos.map((r) => (
                <tr key={r.id} className="border-b border-border align-top last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/reclamos/${r.id}`} className="font-medium text-accent hover:underline">
                      #{r.id}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{fmtDia(r.creadoEn)}</td>
                  <td className="px-4 py-3">
                    {r.clienteNombre}
                    <div className="text-xs text-foreground-muted">Pedido #{r.pedidoId} · cargó {r.creadoPorNombre}</div>
                  </td>
                  <td className="px-4 py-3">
                    {r.descripcion}
                    {r.motivoDevolucion && <div className="text-xs text-foreground-muted">Devolución: {MOTIVO_DEVOLUCION_LABEL[r.motivoDevolucion]}</div>}
                  </td>
                  <td className="px-4 py-3 text-foreground-muted">{r.causa ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`badge-estado ${r.estado === "CERRADO" ? "badge-ok" : r.estado === "ABIERTO" ? "badge-critico" : "badge-bajo"}`}>
                      {ESTADO_RECLAMO_LABEL[r.estado]}
                    </span>
                    {r.informeEnviadoEn && <div className="mt-1 text-xs text-foreground-muted">Informe enviado a gerencia</div>}
                  </td>
                </tr>
              ))}
              {reclamos.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-foreground-muted">
                    No hay reclamos.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-foreground-muted">
        El historial de reclamos sirve para detectar errores que se repiten y armar procedimientos para evitarlos.
      </p>
    </div>
  );
}
