import Link from "next/link";
import { notFound } from "next/navigation";
import { ESTADO_RECLAMO_LABEL, MOTIVO_DEVOLUCION_LABEL, obtenerReclamo } from "@/lib/data/reclamos";
import { getUsuarioActual } from "@/lib/session";
import { puedeResolverReclamo, puedeVerTrazabilidad } from "@/lib/auth/permisos";
import { fmtFechaHora } from "@/lib/format";
import { AccionesSupervisor, AnalisisReclamo } from "../formularios";

const EVENTO_LABEL: Record<string, string> = {
  CREADO: "Reclamo registrado",
  ANALISIS: "Tomado por el supervisor",
  CAUSA: "Causa",
  SOLUCION: "Solución",
  OBSERVACION: "Observación",
  CERRADO: "Cerrado",
  INFORME: "Informe a gerencia",
};

export default async function ReclamoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usuario = await getUsuarioActual();
  const r = await obtenerReclamo(Number(id));
  if (!r) notFound();
  const supervisor = puedeResolverReclamo(usuario.rol);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/reclamos" className="text-sm text-foreground-muted hover:text-foreground">
          ← Reclamos
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-brand-azul-oscuro">
            Reclamo #{r.id} · {r.clienteNombre}
          </h1>
          <span className={`badge-estado ${r.estado === "CERRADO" ? "badge-ok" : r.estado === "ABIERTO" ? "badge-critico" : "badge-bajo"}`}>
            {ESTADO_RECLAMO_LABEL[r.estado]}
          </span>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
        <p>{r.descripcion}</p>
        <div className="flex flex-wrap gap-4 text-foreground-muted">
          <Link href={`/pedidos/${r.pedidoId}`} className="text-accent hover:underline">
            Pedido #{r.pedidoId}
          </Link>
          {puedeVerTrazabilidad(usuario.rol) && (
            <Link href={`/trazabilidad?tipo=pedido&valor=${r.pedidoId}`} className="text-accent hover:underline">
              Trazabilidad del pedido
            </Link>
          )}
          {r.cajaCodigo && (
            <Link href={`/trazabilidad?tipo=caja&valor=${r.cajaCodigo}`} className="font-mono text-accent hover:underline">
              Caja {r.cajaCodigo}
            </Link>
          )}
          {r.motivoDevolucion && <span>Devolución: {MOTIVO_DEVOLUCION_LABEL[r.motivoDevolucion]}</span>}
          <span>
            Registró {r.creadoPorNombre}, {fmtFechaHora(r.creadoEn)}
          </span>
          {r.supervisorNombre && <span>Supervisor: {r.supervisorNombre}</span>}
        </div>
        {(r.causa || r.solucion) && (
          <div className="grid gap-2 border-t border-border pt-2 sm:grid-cols-2">
            <div>
              <div className="text-xs font-medium uppercase text-foreground-muted">Causa</div>
              {r.causa ?? "—"}
            </div>
            <div>
              <div className="text-xs font-medium uppercase text-foreground-muted">Solución</div>
              {r.solucion ?? "—"}
            </div>
          </div>
        )}
        <Link href={`/reclamos/${r.id}/informe`} className="inline-block text-sm font-medium text-accent hover:underline">
          Ver informe imprimible
        </Link>
      </div>

      {supervisor && r.estado !== "CERRADO" && (
        <AnalisisReclamo id={r.id} causa={r.causa} solucion={r.solucion} observaciones={r.observaciones} />
      )}
      {supervisor && <AccionesSupervisor id={r.id} cerrado={r.estado === "CERRADO"} informeEnviado={r.informeEnviadoEn != null} />}
      {!supervisor && r.estado !== "CERRADO" && (
        <p className="text-sm text-foreground-muted">El análisis, la causa, la solución y el cierre los registra el supervisor.</p>
      )}

      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">Historial</h2>
        <ol className="space-y-2">
          {r.eventos.map((e) => (
            <li key={e.id}>
              <span className="font-medium">{EVENTO_LABEL[e.tipo] ?? e.tipo}</span>
              <span className="text-foreground-muted">
                {" "}
                · {e.usuarioNombre}, {fmtFechaHora(e.creadoEn)}
              </span>
              {e.detalle && <div className="text-foreground-muted">{e.detalle}</div>}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
