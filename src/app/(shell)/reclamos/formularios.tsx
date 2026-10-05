"use client";

import { useActionState } from "react";
import {
  analizarReclamoAction,
  cerrarReclamoAction,
  crearReclamoAction,
  informeGerenciaAction,
  type EstadoForm,
} from "@/app/actions/reclamos";

const BOTON = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";

function Mensaje({ s }: { s: EstadoForm }) {
  if (s.error) return <div className="text-sm font-medium text-[var(--estado-critico-fg)]">{s.error}</div>;
  if (s.ok) return <div className="text-sm font-medium text-[var(--estado-ok-fg)]">{s.ok}</div>;
  return null;
}

export function NuevoReclamo({
  pedidoId,
  pedidos,
  motivos,
}: {
  pedidoId: number | null;
  pedidos: { id: number; etiqueta: string }[];
  motivos: { valor: string; etiqueta: string }[];
}) {
  const [state, action, pendiente] = useActionState<EstadoForm, FormData>(crearReclamoAction, {});
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <label className="block text-sm">
        <span className="mb-1 block text-foreground-muted">Pedido *</span>
        <select name="pedidoId" required defaultValue={pedidoId ?? ""} className="input">
          <option value="" disabled>
            Buscá el pedido…
          </option>
          {pedidos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.etiqueta}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-foreground-muted">Qué pasó *</span>
        <textarea name="descripcion" required rows={3} className="input" />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Si hay devolución, motivo</span>
          <select name="motivoDevolucion" defaultValue="" className="input">
            <option value="">No hay devolución</option>
            {motivos.map((m) => (
              <option key={m.valor} value={m.valor}>
                {m.etiqueta}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Código de caja (si se conoce)</span>
          <input name="cajaCodigo" className="input font-mono" placeholder="P00012-C0003" />
        </label>
      </div>
      <button type="submit" disabled={pendiente} className={BOTON}>
        Registrar reclamo
      </button>
      <p className="text-xs text-foreground-muted">El reclamo pasa al supervisor, que recibe un aviso.</p>
      <Mensaje s={state} />
    </form>
  );
}

export function AnalisisReclamo({
  id,
  causa,
  solucion,
  observaciones,
}: {
  id: number;
  causa: string | null;
  solucion: string | null;
  observaciones: string | null;
}) {
  const [state, action, pendiente] = useActionState<EstadoForm, FormData>(analizarReclamoAction, {});
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">Análisis del supervisor</h2>
      <input type="hidden" name="id" value={id} />
      <label className="block text-sm">
        <span className="mb-1 block text-foreground-muted">Causa</span>
        <textarea name="causa" defaultValue={causa ?? ""} rows={2} className="input" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-foreground-muted">Solución</span>
        <textarea name="solucion" defaultValue={solucion ?? ""} rows={2} className="input" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-foreground-muted">Observaciones</span>
        <textarea name="observaciones" defaultValue={observaciones ?? ""} rows={2} className="input" />
      </label>
      <button type="submit" disabled={pendiente} className={BOTON}>
        Guardar análisis
      </button>
      <Mensaje s={state} />
    </form>
  );
}

export function AccionesSupervisor({ id, cerrado, informeEnviado }: { id: number; cerrado: boolean; informeEnviado: boolean }) {
  const [cierre, cerrar, cerrando] = useActionState<EstadoForm, FormData>(cerrarReclamoAction, {});
  const [informe, enviar, enviando] = useActionState<EstadoForm, FormData>(informeGerenciaAction, {});
  return (
    <div className="flex flex-wrap items-start gap-4">
      {!cerrado && (
        <form action={cerrar} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <input name="observaciones" className="input w-64" placeholder="Observación de cierre (opcional)" />
          <button type="submit" disabled={cerrando} className={BOTON}>
            Cerrar reclamo
          </button>
          <Mensaje s={cierre} />
        </form>
      )}
      <form action={enviar} className="flex items-center gap-2">
        <input type="hidden" name="id" value={id} />
        <button type="submit" disabled={enviando} className="rounded-md bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground">
          {informeEnviado ? "Reenviar informe a gerencia" : "Enviar informe a gerencia"}
        </button>
        <Mensaje s={informe} />
      </form>
    </div>
  );
}
