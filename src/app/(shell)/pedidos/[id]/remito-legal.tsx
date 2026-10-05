"use client";

import { useActionState } from "react";
import { remitoLegalAction, type EstadoForm } from "@/app/actions/despachos";

/** N° del remito legal que emitió administración, asociado al despacho. */
export function RemitoLegal({ pedidoId, despachoId, actual }: { pedidoId: number; despachoId: number; actual: string | null }) {
  const [state, action, pendiente] = useActionState<EstadoForm, FormData>(remitoLegalAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <input type="hidden" name="despachoId" value={despachoId} />
      <input name="numero" defaultValue={actual ?? ""} required placeholder="N° remito legal" className="input w-40" />
      <button type="submit" disabled={pendiente} className="text-sm font-medium text-accent hover:underline">
        {actual ? "Corregir" : "Registrar"}
      </button>
      {state.error && <span className="text-sm text-[var(--estado-critico-fg)]">{state.error}</span>}
      {state.ok && <span className="text-sm text-[var(--estado-ok-fg)]">{state.ok}</span>}
    </form>
  );
}
