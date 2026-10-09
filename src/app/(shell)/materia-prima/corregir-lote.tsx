"use client";

import { useActionState } from "react";
import { corregirLoteAction, type EstadoMaquina } from "@/app/actions/maquina";

/** Corrección de Supervisión de los kg ingresados de un lote (error de carga). */
export function CorregirLote({ loteId, ingresado }: { loteId: number; ingresado: number }) {
  const [state, action, pendiente] = useActionState<EstadoMaquina, FormData>(corregirLoteAction, {});
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-foreground-muted">Corregir ingreso</summary>
      <form action={action} className="mt-1 space-y-1">
        <input type="hidden" name="loteId" value={loteId} />
        <input name="cantidadKg" type="number" step="any" min="0" required defaultValue={ingresado} className="input w-28 text-xs" aria-label="Kg ingresados" />
        <input name="motivo" required placeholder="motivo" className="input w-40 text-xs" />
        <button type="submit" disabled={pendiente} className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground disabled:opacity-60">
          Corregir
        </button>
        {state.error && <p className="text-[var(--estado-critico-fg)]">{state.error}</p>}
        {state.ok && <p className="text-[var(--estado-ok-fg)]">{state.ok}</p>}
      </form>
    </details>
  );
}
