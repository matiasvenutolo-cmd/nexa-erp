import Link from "next/link";
import type { pedidosDeMaterialPendientes } from "@/lib/data/taller";
import { fmtFechaHora } from "@/lib/format";

/** Pedidos de material del operario sin atender (se atienden con un retiro a esa máquina). */
export function PedidosDeMaterial({ pedidos }: { pedidos: Awaited<ReturnType<typeof pedidosDeMaterialPendientes>> }) {
  if (pedidos.length === 0) return null;
  return (
    <section className="aviso aviso-alerta mb-5 space-y-1.5">
      <b>Piden material a pie de máquina</b>
      {pedidos.map(({ n, usuarioNombre }) => (
        <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            Inyectora {n.inyectora} · {n.detalle} <span className="text-xs">({fmtFechaHora(n.fecha)} · {usuarioNombre})</span>
          </span>
          {n.cicloId && (
            <Link href={`/materia-prima/retiro?ciclo=${n.cicloId}`} className="btn btn-primary btn-sm">
              Llevar material
            </Link>
          )}
        </div>
      ))}
    </section>
  );
}
