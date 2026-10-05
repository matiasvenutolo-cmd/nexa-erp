"use client";

import { useActionState, useMemo, useState } from "react";
import { cerrarCicloAction, type FormState } from "@/app/actions/produccion";

/** Cierre del día (docs/06-comentarios-produccion.md §3.2/§7 — decisión "por
 *  día"): el operario cierra acá aunque siga con el mismo color mañana; la
 *  continuidad la da la partida y el golpesInicio del ciclo siguiente. */
export function FormularioCierre({
  cicloId,
  golpesInicio,
  piezasPorGolpe,
}: {
  cicloId: number;
  golpesInicio: number | null;
  piezasPorGolpe: number | null;
}) {
  const [state, formAction, pendiente] = useActionState<FormState, FormData>(cerrarCicloAction, {});
  const [golpesFin, setGolpesFin] = useState("");
  const [descartadas, setDescartadas] = useState("");

  const piezasProducidas = useMemo(() => {
    if (!golpesFin || golpesInicio == null || piezasPorGolpe == null) return null;
    return (Number(golpesFin) - golpesInicio) * piezasPorGolpe;
  }, [golpesFin, golpesInicio, piezasPorGolpe]);

  const piezasEntregadasSugerida =
    piezasProducidas != null ? Math.max(0, piezasProducidas - (Number(descartadas) || 0)) : null;

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-foreground-muted">Cierre del día</h2>
      {state.error && (
        <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">
          {state.error}
        </div>
      )}
      <input type="hidden" name="cicloId" value={cicloId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Golpes de fin</span>
          <input
            name="golpesFin"
            type="number"
            required
            className="input"
            value={golpesFin}
            onChange={(e) => setGolpesFin(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Piezas producidas (calculado)</span>
          <input className="input bg-surface-muted" readOnly value={piezasProducidas ?? ""} />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Piezas descartadas</span>
          <input
            name="piezasDescartadas"
            type="number"
            className="input"
            value={descartadas}
            onChange={(e) => setDescartadas(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Piezas a stock</span>
          <input
            name="piezasEntregadas"
            type="number"
            min={0}
            required
            className="input"
            defaultValue={piezasEntregadasSugerida ?? ""}
            key={piezasEntregadasSugerida ?? "vacio"}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Colada (kg)</span>
          <input name="coladaKg" type="number" step="0.001" className="input" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Rebarba (kg)</span>
          <input name="rebarbaKg" type="number" step="0.001" className="input" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Scrap (kg)</span>
          <input name="scrapKg" type="number" step="0.001" className="input" />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-foreground-muted">Motivo de cambio de ciclo (si aplica)</span>
        <input name="cambioCicloCausa" className="input" placeholder="opcional" />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-foreground-muted">Observaciones</span>
        <input name="observaciones" className="input" placeholder="opcional" />
      </label>

      <label className="flex items-center gap-2 text-sm text-foreground-muted">
        <input type="checkbox" name="cerrarPartida" />
        No se va a seguir produciendo este color — cerrar también la partida
      </label>

      <button
        type="submit"
        disabled={pendiente}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        Cerrar ciclo
      </button>
    </form>
  );
}
