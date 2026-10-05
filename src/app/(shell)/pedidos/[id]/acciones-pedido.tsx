"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  pasarAArmadoAction,
  marcarListoAction,
  marcarEntregadoAction,
  cancelarPedidoAction,
  type FormState,
} from "@/app/actions/pedidos";
import type { pedido } from "@/lib/db/schema";

type Estado = (typeof pedido.$inferSelect)["estado"];

/** Botones del ciclo de vida — sólo se ofrece la transición que corresponde
 *  al estado actual (docs/07-plan-release-2.md paso 1). */
export function AccionesPedido({ pedidoId, estado }: { pedidoId: number; estado: Estado }) {
  const router = useRouter();
  const [entregando, setEntregando] = useState(false);
  const [state, entregarAction, pendiente] = useActionState<FormState, FormData>(marcarEntregadoAction, {});

  const [cancelando, setCancelando] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  if (estado === "ENTREGADO" || estado === "CANCELADO") return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {estado === "PEDIDO" && (
        <BotonSimple accion={() => pasarAArmadoAction(pedidoId)} label="Pasar a armado" />
      )}
      {estado === "EN_ARMADO" && (
        <BotonSimple accion={() => marcarListoAction(pedidoId)} label="Marcar listo para despachar" />
      )}
      {(estado === "LISTO_PARA_DESPACHAR" || estado === "PARCIALMENTE_DESPACHADO") &&
        (entregando ? (
          <form action={entregarAction} className="flex items-center gap-2">
            <input type="hidden" name="pedidoId" value={pedidoId} />
            <input name="numeroRemito" placeholder="N° remito legal (si se usa)" className="input w-52" />
            <button
              type="submit"
              disabled={pendiente}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
            >
              Confirmar entrega
            </button>
            <button
              type="button"
              onClick={() => setEntregando(false)}
              className="text-sm text-foreground-muted hover:text-foreground"
            >
              Cancelar
            </button>
          </form>
        ) : (
          <button
            onClick={() => setEntregando(true)}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Marcar entregado
          </button>
        ))}
      {state.error && <span className="text-sm text-[var(--estado-critico-fg)]">{state.error}</span>}

      {cancelando ? (
        <span className="flex items-center gap-2 text-sm">
          <span className="text-foreground-muted">¿Cancelar? Se libera el stock reservado.</span>
          <button
            onClick={async () => {
              const r = await cancelarPedidoAction(pedidoId);
              if (r.error) setCancelError(r.error);
              else router.refresh();
            }}
            className="font-medium text-[var(--estado-critico-fg)] hover:underline"
          >
            Sí, cancelar
          </button>
          <button onClick={() => setCancelando(false)} className="text-foreground-muted hover:text-foreground">
            No
          </button>
        </span>
      ) : (
        <button
          onClick={() => setCancelando(true)}
          className="text-sm text-[var(--estado-critico-fg)] hover:underline"
        >
          Cancelar pedido
        </button>
      )}
      {cancelError && <span className="text-sm text-[var(--estado-critico-fg)]">{cancelError}</span>}
    </div>
  );
}

function BotonSimple({ accion, label }: { accion: () => Promise<{ error?: string }>; label: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendiente, setPendiente] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <button
        disabled={pendiente}
        onClick={async () => {
          setPendiente(true);
          const r = await accion();
          setPendiente(false);
          if (r.error) setError(r.error);
          else router.refresh();
        }}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        {label}
      </button>
      {error && <span className="text-sm text-[var(--estado-critico-fg)]">{error}</span>}
    </div>
  );
}
