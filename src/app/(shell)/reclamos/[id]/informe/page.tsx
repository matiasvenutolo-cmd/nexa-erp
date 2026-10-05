import Link from "next/link";
import { notFound } from "next/navigation";
import { ESTADO_RECLAMO_LABEL, MOTIVO_DEVOLUCION_LABEL, obtenerReclamo } from "@/lib/data/reclamos";
import { fmtFechaHora } from "@/lib/format";
import { BotonImprimir } from "@/app/(shell)/pedidos/[id]/remito/[despachoId]/imprimir";

export default async function InformeReclamoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await obtenerReclamo(Number(id));
  if (!r) notFound();
  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/reclamos/${r.id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← Reclamo #{r.id}
        </Link>
        <BotonImprimir />
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-white p-6 text-sm text-black">
        <h1 className="text-lg font-semibold">Informe de reclamo #{r.id} — NEXA</h1>
        <div className="grid grid-cols-2 gap-2">
          <div>Cliente: {r.clienteNombre}</div>
          <div>Pedido: #{r.pedidoId}</div>
          <div>Registrado: {fmtFechaHora(r.creadoEn)} por {r.creadoPorNombre}</div>
          <div>Estado: {ESTADO_RECLAMO_LABEL[r.estado]}</div>
          {r.motivoDevolucion && <div>Devolución: {MOTIVO_DEVOLUCION_LABEL[r.motivoDevolucion]}</div>}
          {r.cajaCodigo && <div>Caja: {r.cajaCodigo}</div>}
        </div>
        <div>
          <div className="font-semibold">Qué pasó</div>
          {r.descripcion}
        </div>
        <div>
          <div className="font-semibold">Causa (supervisor)</div>
          {r.causa ?? "—"}
        </div>
        <div>
          <div className="font-semibold">Solución</div>
          {r.solucion ?? "—"}
        </div>
        {r.observaciones && (
          <div>
            <div className="font-semibold">Observaciones</div>
            {r.observaciones}
          </div>
        )}
        <div>
          <div className="font-semibold">Historial</div>
          <ol className="list-decimal pl-5">
            {r.eventos.map((e) => (
              <li key={e.id}>
                {fmtFechaHora(e.creadoEn)} · {e.usuarioNombre} · {e.tipo}
                {e.detalle ? `: ${e.detalle}` : ""}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
