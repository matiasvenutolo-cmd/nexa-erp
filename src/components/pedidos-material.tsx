import Link from "next/link";
import type { pedidosDeMaterialPendientes } from "@/lib/data/taller";
import { FormAccion } from "@/components/form-accion";
import { avisarPedidoMaterialAction, descartarPedidoMaterialAction } from "@/app/actions/taller";
import { fmtFechaHora } from "@/lib/format";

/**
 * Pedidos de material del operario sin atender (cambios del 23/11/2026):
 * - el Encargado da el OK (le llega a Materia prima) o lo descarta;
 * - Materia prima ve los que tienen el OK y registra que se llevó.
 */
export function PedidosDeMaterial({ pedidos, modo }: { pedidos: Awaited<ReturnType<typeof pedidosDeMaterialPendientes>>; modo: "encargado" | "materia-prima" }) {
  if (pedidos.length === 0) return null;
  return (
    <section className="aviso aviso-alerta mb-5 space-y-2">
      <b>{modo === "encargado" ? "El operario pide material a pie de máquina" : "Material pedido desde la máquina"}</b>
      {pedidos.map(({ n, usuarioNombre }) => (
        <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-[rgba(180,82,26,0.2)] pt-2 text-sm first:border-0 first:pt-0">
          <span>
            Inyectora {n.inyectora} · {n.pedido?.length ? n.pedido.map((x) => x.texto).join(" + ") : n.detalle}{" "}
            <span className="text-xs">({fmtFechaHora(n.fecha)} · {usuarioNombre})</span>
          </span>
          {modo === "encargado" ? (
            n.avisadoMpEn ? (
              <span className="badge-estado badge-ok">Avisado a Materia prima</span>
            ) : (
              <span className="flex flex-wrap gap-2">
                <FormAccion accion={avisarPedidoMaterialAction} ocultos={{ novedadId: n.id }} boton="OK, avisar a Materia prima" claseBoton="btn btn-primary btn-sm" className="flex" />
                <FormAccion accion={descartarPedidoMaterialAction} ocultos={{ novedadId: n.id }} boton="Descartar" claseBoton="btn btn-outline btn-sm" className="flex" />
              </span>
            )
          ) : (
            n.cicloId && (
              <Link href={`/materia-prima/retiro?ciclo=${n.cicloId}&pedido=${n.id}#registrar`} className="btn btn-primary btn-sm">
                Registrar que se llevó
              </Link>
            )
          )}
        </div>
      ))}
    </section>
  );
}
