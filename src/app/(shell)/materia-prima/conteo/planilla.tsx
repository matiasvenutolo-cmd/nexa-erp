"use client";

import { useActionState, useState } from "react";
import { conteoMpAction, type EstadoForm } from "@/app/actions/materia-prima";
import { fmtPeso, parseCantidadAR } from "@/lib/presentaciones";

type Fila = { id: number; codigo: string; nombre: string; teorico: number };

/** Planilla del conteo: stock teórico a la fecha, físico, diferencia y justificación. */
export function PlanillaConteo({ filas, fecha }: { filas: Fila[]; fecha: string }) {
  const [state, action, pendiente] = useActionState<EstadoForm, FormData>(conteoMpAction, {});
  const [contado, setContado] = useState<Record<number, string>>({});
  const dif = (f: Fila) => {
    const v = contado[f.id]?.trim();
    if (!v) return null;
    const n = parseCantidadAR(v);
    return n == null ? NaN : Math.round((n - f.teorico) * 1000) / 1000;
  };
  const cargados = filas.filter((f) => dif(f) != null).length;
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="fecha" value={fecha} />
      <div className="overflow-x-auto">
        <table className="tabla">
          <thead>
            <tr>
              <th>Material</th>
              <th className="text-right">Stock teórico</th>
              <th>Stock físico (kg)</th>
              <th className="text-right">Diferencia</th>
              <th>Justificación</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => {
              const d = dif(f);
              return (
                <tr key={f.id}>
                  <td>{f.nombre}</td>
                  <td className="text-right tabular-nums">{fmtPeso(f.teorico)}</td>
                  <td>
                    <input name={`c_${f.id}`} inputMode="decimal" className="input w-32" value={contado[f.id] ?? ""} onChange={(e) => setContado({ ...contado, [f.id]: e.target.value })} />
                  </td>
                  <td className={`whitespace-nowrap text-right tabular-nums ${d != null && d !== 0 ? "font-semibold text-red-700" : ""}`}>
                    {d == null ? "" : Number.isNaN(d) ? "?" : d === 0 ? "—" : `${d > 0 ? "+" : "−"}${fmtPeso(Math.abs(d))}`}
                  </td>
                  <td>{d != null && d !== 0 && <input name={`m_${f.id}`} required className="input w-56" placeholder="Por qué no coincide" />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <label className="block text-sm">
        Observaciones
        <input name="observaciones" className="input mt-1 w-full max-w-xl" placeholder="opcional" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="ajustar" value="1" />
        Ajustar el stock del sistema a lo contado (queda un movimiento de inventario por cada diferencia)
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pendiente || cargados === 0}>
          {pendiente ? "Guardando…" : `Guardar conteo${cargados ? ` (${cargados})` : ""}`}
        </button>
        <span className="text-sm text-foreground-muted">Los materiales que dejes en blanco no se cuentan.</span>
      </div>
      {state.error && <p className="aviso aviso-error">{state.error}</p>}
      {state.ok && <p className="aviso aviso-ok">{state.ok}</p>}
    </form>
  );
}
