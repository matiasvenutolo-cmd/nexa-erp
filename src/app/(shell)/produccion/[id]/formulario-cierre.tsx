"use client";

import { useActionState, useMemo, useState } from "react";
import { cerrarCicloAction, type FormState } from "@/app/actions/produccion";

/** Cierre de producción (minuta 15/10): el cierre definitivo, distinto del
 *  relevo de turno. Golpes de fin y descarte vienen de los turnos; la colada
 *  se calcula sola si el producto la tiene configurada. */
export function FormularioCierre({
  cicloId,
  golpesInicio,
  piezasPorGolpe,
  pendientePedidos,
  stockActual,
  minimo,
  deseada,
  golpesSugeridos,
  descarteKg,
  kgPorUnidad,
}: {
  cicloId: number;
  golpesInicio: number | null;
  piezasPorGolpe: number | null;
  /** Lo que los pedidos abiertos todavía esperan de este producto. */
  pendientePedidos: number;
  stockActual: number;
  minimo: number | null;
  deseada: number | null;
  golpesSugeridos?: number | null;
  descarteKg?: number;
  kgPorUnidad?: number | null;
}) {
  const [state, formAction, pendiente] = useActionState<FormState, FormData>(cerrarCicloAction, {});
  const [golpesFin, setGolpesFin] = useState(golpesSugeridos != null ? String(golpesSugeridos) : "");
  const descartePiezas = descarteKg && kgPorUnidad ? Math.round(descarteKg / kgPorUnidad) : null;
  const [descartadas, setDescartadas] = useState(descartePiezas != null ? String(descartePiezas) : "");
  const [aStock, setAStock] = useState<string | null>(null);

  const piezasProducidas = useMemo(() => {
    if (!golpesFin || golpesInicio == null || piezasPorGolpe == null) return null;
    return (Number(golpesFin) - golpesInicio) * piezasPorGolpe;
  }, [golpesFin, golpesInicio, piezasPorGolpe]);

  const piezasEntregadasSugerida =
    piezasProducidas != null ? Math.max(0, piezasProducidas - (Number(descartadas) || 0)) : null;

  return (
    <form action={formAction} className="panel space-y-4">
      <h2 className="panel-titulo">Cierre de producción</h2>
      <p className="text-xs text-foreground-muted">
        Es el cierre definitivo (no el relevo de turno): lo bueno entra a stock y se registra el consumo de la tolva. Si hay un turno abierto, se cierra con estos golpes.
        {descarteKg ? ` Descarte pesado en los turnos: ${descarteKg} kg${descartePiezas != null ? ` ≈ ${descartePiezas} piezas` : ""}.` : ""}
      </p>
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
          <span className="mb-1 block text-foreground-muted">Piezas que entran a stock</span>
          <input
            name="piezasEntregadas"
            type="number"
            min={0}
            required
            className="input"
            value={aStock ?? piezasEntregadasSugerida ?? ""}
            onChange={(e) => setAStock(e.target.value)}
          />
          <span className="mt-1 block text-xs text-foreground-muted">
            Se calcula como producidas − descartadas. Corregilo sólo si quedaron piezas sin entregar al depósito.
          </span>
        </label>
      </div>

      <Destino entran={Number(aStock ?? piezasEntregadasSugerida ?? 0) || 0} pendiente={pendientePedidos} stock={stockActual} minimo={minimo} deseada={deseada} producidas={piezasProducidas} />

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Colada (kg) — vacío: se calcula</span>
          <input name="coladaKg" type="number" step="0.001" className="input" placeholder="automática" />
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
        className="btn btn-primary"
      >
        Cerrar la producción
      </button>
    </form>
  );
}

/** Dónde impacta cada número: todo lo que entra va al stock general; los
 *  pedidos lo toman al armar el despacho y el resto queda libre. */
function Destino({
  entran,
  pendiente,
  stock,
  minimo,
  deseada,
  producidas,
}: {
  entran: number;
  pendiente: number;
  stock: number;
  minimo: number | null;
  deseada: number | null;
  producidas: number | null;
}) {
  const total = stock + entran;
  const cubre = Math.min(total, pendiente);
  const libre = Math.max(0, total - pendiente);
  return (
    <div className="rounded-md bg-surface-muted px-3 py-2 text-xs text-foreground-muted">
      <span className="font-medium text-foreground">Destino de lo producido:</span> entran {entran} piezas al stock (en cajas). Stock
      después del cierre: {total}. Los pedidos abiertos esperan {pendiente}: el stock cubre {cubre}
      {pendiente > total ? ` y siguen faltando ${pendiente - total}` : ""}; quedan {libre} libres para stock
      {minimo != null && minimo > 0 ? ` (mínimo configurado ${minimo}${libre < minimo ? `: faltan ${minimo - libre} para reponerlo` : ": cubierto"})` : ""}.
      {deseada != null && producidas != null && ` Inyección deseada ${deseada}, producidas ${producidas}.`}
    </div>
  );
}
