"use client";

import { useActionState } from "react";
import { asignarProductoAction, cambiarPrioridadAction, type FormState } from "@/app/actions/pedidos";
import { iniciarDespachoAction } from "@/app/actions/despachos";

/** Ajuste manual de la prioridad de inyección (Encargado o Supervisor), con motivo. */
export function ControlPrioridad({
  pedidoId,
  actual,
  niveles,
  motivos,
}: {
  pedidoId: number;
  actual: number;
  niveles: readonly { valor: number; etiqueta: string }[];
  motivos: readonly string[];
}) {
  const [state, action, pendiente] = useActionState<FormState, FormData>(cambiarPrioridadAction, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <label className="block text-xs text-foreground-muted">
        Prioridad
        <select name="prioridad" defaultValue={actual} className="input mt-1 w-48">
          {niveles.map((n) => (
            <option key={n.valor} value={n.valor}>
              {n.etiqueta}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-foreground-muted">
        Motivo
        <select name="motivo" required defaultValue="" className="input mt-1 w-56">
          <option value="" disabled>
            Elegí el motivo…
          </option>
          {motivos.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="block flex-1 text-xs text-foreground-muted">
        Detalle
        <input name="detalle" className="input mt-1" placeholder="opcional" />
      </label>
      <button
        type="submit"
        disabled={pendiente}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        Cambiar prioridad
      </button>
      {state.error && <span className="w-full text-sm text-[var(--estado-critico-fg)]">{state.error}</span>}
      {state.ok && <span className="w-full text-sm text-[var(--estado-ok-fg)]">Prioridad actualizada y registrada.</span>}
    </form>
  );
}

/**
 * Renglón histórico (importado del Excel) sin producto: se vincula al producto
 * exacto del catálogo. Sólo se ofrecen productos del color que dice el renglón;
 * si el texto no permite saberlo, el renglón queda como dato pendiente.
 */
export function VincularProducto({
  pedidoId,
  lineaId,
  productos,
  requiereConfirmacion,
}: {
  pedidoId: number;
  lineaId: number;
  productos: { id: number; codigo: string; descripcion: string }[];
  requiereConfirmacion: boolean;
}) {
  const [state, action, pendiente] = useActionState<FormState, FormData>(asignarProductoAction, {});
  return (
    <form action={action} className="mt-2 space-y-1.5 rounded-md border border-border p-2">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <input type="hidden" name="lineaId" value={lineaId} />
      <label className="block text-xs text-foreground-muted">
        Vincular al producto del catálogo (tipo y color)
        <select name="productoId" required defaultValue="" className="input mt-1 w-full text-xs">
          <option value="" disabled>
            Elegí el producto…
          </option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} · {p.descripcion}
            </option>
          ))}
        </select>
      </label>
      {requiereConfirmacion && (
        <label className="block text-xs text-foreground-muted">
          Cómo se confirmó (el Excel no dice el color)
          <input name="confirmacion" required className="input mt-1 w-full text-xs" placeholder="ej. confirmado con el cliente por teléfono" />
        </label>
      )}
      <button type="submit" disabled={pendiente} className="text-xs font-medium text-accent hover:underline">
        Vincular producto
      </button>
      {state.error && <p className="text-xs text-[var(--estado-critico-fg)]">{state.error}</p>}
    </form>
  );
}

export function BotonPrepararDespacho({ pedidoId }: { pedidoId: number }) {
  const [state, action, pendiente] = useActionState(async () => iniciarDespachoAction(pedidoId), {} as { error?: string });
  return (
    <form action={action} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pendiente}
        className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        Preparar despacho
      </button>
      {state.error && <span className="text-sm text-[var(--estado-critico-fg)]">{state.error}</span>}
    </form>
  );
}
