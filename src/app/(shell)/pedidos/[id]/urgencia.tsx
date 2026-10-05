"use client";

import { useActionState, useState } from "react";
import { cambiarUrgenciaAction, type FormState } from "@/app/actions/pedidos";

/** Excepción controlada a la prioridad automática por fecha (Encargado o Supervisor). */
export function ControlUrgencia({ pedidoId, urgente }: { pedidoId: number; urgente: boolean }) {
  const [state, action, pendiente] = useActionState<FormState, FormData>(cambiarUrgenciaAction, {});
  const [abierto, setAbierto] = useState(false);

  if (urgente) {
    return (
      <form action={action} className="flex items-center gap-2">
        <input type="hidden" name="pedidoId" value={pedidoId} />
        <input type="hidden" name="urgente" value="0" />
        <button type="submit" disabled={pendiente} className="text-sm font-medium text-accent hover:underline">
          Quitar urgencia
        </button>
        {state.error && <span className="text-sm text-[var(--estado-critico-fg)]">{state.error}</span>}
      </form>
    );
  }

  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="text-sm font-medium text-accent hover:underline">
        Marcar urgente para producción
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <input type="hidden" name="urgente" value="1" />
      <input name="motivo" required placeholder="Motivo (queda registrado)" className="input w-64" />
      <button
        type="submit"
        disabled={pendiente}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        Marcar urgente
      </button>
      <button type="button" onClick={() => setAbierto(false)} className="text-sm text-foreground-muted hover:text-foreground">
        Cancelar
      </button>
      {state.error && <span className="text-sm text-[var(--estado-critico-fg)]">{state.error}</span>}
    </form>
  );
}
