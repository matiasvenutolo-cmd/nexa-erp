"use client";

import { useActionState, useRef, useState } from "react";
import {
  anularDespachoAction,
  controlFinalAction,
  piquearAction,
  primerControlAction,
  type EstadoForm,
} from "@/app/actions/despachos";

const BOTON = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";

function Mensaje({ s }: { s: EstadoForm }) {
  if (s.error) return <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">{s.error}</div>;
  if (s.alerta) return <div className="rounded-md bg-[var(--estado-bajo-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-bajo-fg)]">⚠ {s.alerta}</div>;
  if (s.ok) return <div className="rounded-md bg-[var(--estado-ok-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-ok-fg)]">{s.ok}</div>;
  return null;
}

/**
 * Lectura de códigos: el lector de códigos de barras escribe y "presiona
 * Enter". Los campos no son controlados: React los limpia solo al terminar
 * cada lectura y la página se refresca con la lista actualizada.
 */
export function Piqueo({
  pedidoId,
  despachoId,
  etapa,
  sugerencias,
}: {
  pedidoId: number;
  despachoId: number;
  etapa: "ARMADO" | "CONTROL_FINAL";
  sugerencias: { codigo: string; detalle: string }[];
}) {
  const [state, action, pendiente] = useActionState<EstadoForm, FormData>(piquearAction, {});
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="pedidoId" value={pedidoId} />
        <input type="hidden" name="despachoId" value={despachoId} />
        <label className="block flex-1 text-sm">
          <span className="mb-1 block text-foreground-muted">
            {etapa === "ARMADO" ? "Leer caja o producto para armar" : "Leer de nuevo cada caja/producto que sale (control final)"}
          </span>
          <input
            ref={ref}
            name="codigo"
            autoFocus
            required
            autoComplete="off"
            placeholder="P00012-C0003 o 001B-PR-NE"
            className="input font-mono"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Cantidad</span>
          <input name="cantidad" type="number" min={1} step={1} placeholder="toda la caja" className="input w-32" />
        </label>
        <button type="submit" disabled={pendiente} className={BOTON}>
          Registrar lectura
        </button>
      </form>
      <Mensaje s={state} />
      {sugerencias.length > 0 && (
        <div className="text-xs text-foreground-muted">
          {etapa === "ARMADO" ? "Cajas disponibles (las más viejas primero): " : "Lo armado en este despacho: "}
          {sugerencias.map((s) => (
            <button
              key={s.codigo}
              type="button"
              onClick={() => {
                if (ref.current) {
                  ref.current.value = s.codigo;
                  ref.current.focus();
                }
              }}
              className="mr-2 mt-1 inline-block rounded bg-surface-muted px-1.5 py-0.5 font-mono hover:text-foreground"
              title={s.detalle}
            >
              {s.codigo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ConfirmarControl({
  pedidoId,
  despachoId,
  etapa,
}: {
  pedidoId: number;
  despachoId: number;
  etapa: "ARMADO" | "CONTROL_FINAL";
}) {
  const [state, action, pendiente] = useActionState<EstadoForm, FormData>(
    etapa === "ARMADO" ? primerControlAction : controlFinalAction,
    {},
  );
  return (
    <form action={action} className="space-y-2 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <input type="hidden" name="despachoId" value={despachoId} />
      <h3 className="text-sm font-semibold">
        {etapa === "ARMADO" ? "Primer control: cerrar el armado" : "Control final y entrega"}
      </h3>
      <p className="text-sm text-foreground-muted">
        {etapa === "ARMADO"
          ? "Confirma que lo armado está completo y bien. El pedido pasa a “Listo para despachar” y se avisa a ventas. Si no se arma todo, el resto queda pendiente para otro despacho."
          : "Lo controlado tiene que coincidir con lo armado. Al confirmar sale el stock de lo que se entrega, se asigna el remito interno y el pedido queda entregado o con lo pendiente."}
      </p>
      <input name="observaciones" className="input" placeholder="Observaciones (opcional)" />
      <button type="submit" disabled={pendiente} className={BOTON}>
        {etapa === "ARMADO" ? "Confirmar primer control" : "Confirmar control final y entregar"}
      </button>
      <Mensaje s={state} />
    </form>
  );
}

export function AnularDespacho({ pedidoId, despachoId }: { pedidoId: number; despachoId: number }) {
  const [state, action, pendiente] = useActionState<EstadoForm, FormData>(anularDespachoAction, {});
  const [abierto, setAbierto] = useState(false);
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="text-sm text-[var(--estado-critico-fg)] hover:underline">
        Anular este despacho
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <input type="hidden" name="despachoId" value={despachoId} />
      <input name="motivo" required placeholder="Motivo de la anulación" className="input w-72" />
      <button type="submit" disabled={pendiente} className="text-sm font-medium text-[var(--estado-critico-fg)] hover:underline">
        Anular
      </button>
      <button type="button" onClick={() => setAbierto(false)} className="text-sm text-foreground-muted">
        No
      </button>
      <Mensaje s={state} />
    </form>
  );
}
