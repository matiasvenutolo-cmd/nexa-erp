"use client";

import { useActionState } from "react";
import { corregirCicloAction, type EstadoMaquina } from "@/app/actions/maquina";

type Actual = {
  golpesFin: number | null;
  piezasDescartadas: number | null;
  piezasEntregadas: number | null;
  coladaKg: string | null;
  rebarbaKg: string | null;
  scrapKg: string | null;
};

/** Corrección de Supervisión del cierre: queda auditada y, si cambian las piezas a stock, se regulariza el stock y las cajas. */
export function CorreccionCierre({ cicloId, actual }: { cicloId: number; actual: Actual }) {
  const [state, action, pendiente] = useActionState<EstadoMaquina, FormData>(corregirCicloAction, {});
  const campo = (name: keyof Actual, label: string, step?: string) => (
    <label className="block text-xs text-foreground-muted">
      {label}
      <input name={name} type="number" step={step} defaultValue={actual[name] ?? ""} className="input mt-1" />
    </label>
  );
  return (
    <details className="rounded-lg border border-border bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-medium">Corregir el cierre (Supervisión)</summary>
      <form action={action} className="mt-3 space-y-3">
        <input type="hidden" name="cicloId" value={cicloId} />
        <div className="grid gap-3 sm:grid-cols-3">
          {campo("golpesFin", "Golpes de fin")}
          {campo("piezasDescartadas", "Piezas descartadas")}
          {campo("piezasEntregadas", "Piezas que entraron a stock")}
          {campo("coladaKg", "Colada (kg)", "0.001")}
          {campo("rebarbaKg", "Rebarba (kg)", "0.001")}
          {campo("scrapKg", "Scrap (kg)", "0.001")}
        </div>
        <label className="block text-xs text-foreground-muted">
          Motivo de la corrección *
          <input name="motivo" required className="input mt-1" placeholder="ej. error de carga en los golpes de fin" />
        </label>
        <p className="text-xs text-foreground-muted">
          Si cambian las piezas a stock, la diferencia se registra como ajuste y se agregan o descuentan unidades de las cajas del ciclo
          que no fueron armadas. Queda en el historial con el valor anterior y el nuevo.
        </p>
        <button type="submit" disabled={pendiente} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-60">
          Guardar corrección
        </button>
        {state.error && <p className="text-xs text-[var(--estado-critico-fg)]">{state.error}</p>}
        {state.ok && <p className="text-xs text-[var(--estado-ok-fg)]">{state.ok}</p>}
      </form>
    </details>
  );
}
