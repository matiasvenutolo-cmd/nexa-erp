"use client";

import { useActionState, useState } from "react";
import {
  anularLineaAction,
  anularMovimientoAction,
  cargarTolvaAction,
  cerrarRetiroAction,
  devolverAction,
  sobranteAction,
  type EstadoMaquina,
} from "@/app/actions/maquina";
import { fmtNumero, fmtDia } from "@/lib/format";

type Accion = (prev: EstadoMaquina, fd: FormData) => Promise<EstadoMaquina>;

export type RetiroVista = {
  id: number;
  numero: string;
  inyectora: string;
  cicloId: number | null;
  estado: "ABIERTO" | "CERRADO";
  lineas: {
    id: number;
    materiaPrimaNombre: string;
    materiaPrimaTipo: string;
    numeroLote: string | null;
    certificadoNumero: number | null;
    anulado: boolean;
    anuladoMotivo: string | null;
    saldo: { retirado: number; cargado: number; devuelto: number; diferencia: number; pie: number };
  }[];
  movimientos: {
    id: number;
    retiroMpId: number | null;
    tipo: "CARGA_TOLVA" | "DEVOLUCION" | "SOBRANTE" | "DIFERENCIA";
    cantidad: number;
    cicloId: number | null;
    destinoNombre: string | null;
    observaciones: string | null;
    usuarioNombre: string;
    fecha: Date | string;
    anulado: boolean;
    anuladoMotivo: string | null;
  }[];
  totales: { retirado: number; cargado: number; devuelto: number; diferencia: number; pie: number; sobrante: number };
};

const TIPO: Record<RetiroVista["movimientos"][number]["tipo"], string> = {
  CARGA_TOLVA: "Carga en tolva",
  DEVOLUCION: "Devolución al depósito",
  SOBRANTE: "Sobrante mezclado",
  DIFERENCIA: "Diferencia justificada",
};

const nuevoToken = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Formulario chico con clave anti-repetición que se renueva tras cada éxito. */
function Mini({ accion, children, boton, ocultos }: { accion: Accion; children?: React.ReactNode; boton: string; ocultos: Record<string, string | number | null> }) {
  const [state, action, pendiente] = useActionState<EstadoMaquina, FormData>(accion, {});
  // Una clave por intento: se mantiene mientras el envío está en curso (un doble
  // clic manda la misma) y cambia con cada respuesta del servidor.
  const [claves] = useState(() => new WeakMap<EstadoMaquina, string>());
  if (!claves.has(state)) claves.set(state, nuevoToken());
  const token = claves.get(state)!;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="token" value={token} />
      {Object.entries(ocultos).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={String(v)} />))}
      {children}
      <button type="submit" disabled={pendiente} className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
        {boton}
      </button>
      {state.error && <span className="w-full text-xs text-[var(--estado-critico-fg)]">{state.error}</span>}
      {state.ok && <span className="w-full text-xs text-[var(--estado-ok-fg)]">{state.ok}</span>}
    </form>
  );
}

export function OperacionesRetiro({
  r,
  ciclos,
  codigosSobrante,
  puedeOperar,
  puedeCorregir,
}: {
  r: RetiroVista;
  /** Ciclos en curso de la misma inyectora (destino de la carga). */
  ciclos: { id: number; etiqueta: string }[];
  codigosSobrante: { id: number; codigo: string; nombre: string }[];
  puedeOperar: boolean;
  puedeCorregir: boolean;
}) {
  const abierto = r.estado === "ABIERTO";
  const base = { retiroMaquinaId: r.id, cicloId: r.cicloId };
  const pendientes = r.lineas.filter((l) => !l.anulado && Math.abs(l.saldo.pie) > 1e-6);
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-foreground-muted">
              <th className="py-2 pr-3">Material</th>
              <th className="py-2 pr-3 text-right">Retirado</th>
              <th className="py-2 pr-3 text-right">Cargado en tolva</th>
              <th className="py-2 pr-3 text-right">Devuelto</th>
              <th className="py-2 pr-3 text-right">Dif. justificada</th>
              <th className="py-2 pr-3 text-right">A pie de máquina</th>
            </tr>
          </thead>
          <tbody>
            {r.lineas.map((l) => (
              <tr key={l.id} className={`border-b border-border align-top last:border-0 ${l.anulado ? "opacity-50" : ""}`}>
                <td className="py-2 pr-3">
                  <div className="font-medium">
                    {l.materiaPrimaNombre}
                    {l.materiaPrimaTipo === "MASTER" && <span className="ml-1 text-xs text-foreground-muted">(master)</span>}
                  </div>
                  <div className="text-xs text-foreground-muted">
                    {l.numeroLote ? `Lote de MP ${l.numeroLote}` : "stock sin lote"}
                    {l.certificadoNumero != null ? ` · certificado N° ${l.certificadoNumero}` : ""}
                  </div>
                  {l.anulado && <div className="text-xs text-[var(--estado-critico-fg)]">Anulada: {l.anuladoMotivo}</div>}
                  {!l.anulado && abierto && puedeOperar && l.saldo.pie > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {ciclos.length > 0 ? (
                        <Mini accion={cargarTolvaAction} boton="Cargar en tolva" ocultos={{ ...base, retiroMpId: l.id }}>
                          <input name="cantidadKg" type="number" step="any" min="0" required placeholder="kg" className="input w-24 text-xs" aria-label="Kg a cargar" />
                          <select name="cicloId" defaultValue={ciclos.find((c) => c.id === r.cicloId)?.id ?? ciclos[0].id} className="input w-56 text-xs" aria-label="Ciclo">
                            {ciclos.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.etiqueta}
                              </option>
                            ))}
                          </select>
                        </Mini>
                      ) : (
                        <p className="text-xs text-foreground-muted">No hay un ciclo en curso en esta inyectora para cargar.</p>
                      )}
                      <Mini accion={devolverAction} boton="Devolver sin mezclar" ocultos={{ ...base, retiroMpId: l.id }}>
                        <input name="cantidadKg" type="number" step="any" min="0" required placeholder="kg" className="input w-24 text-xs" aria-label="Kg a devolver" />
                      </Mini>
                    </div>
                  )}
                  {!l.anulado && puedeCorregir && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-foreground-muted">Anular línea (Supervisión)</summary>
                      <Mini accion={anularLineaAction} boton="Anular línea" ocultos={{ ...base, retiroMpId: l.id }}>
                        <input name="motivo" required placeholder="motivo de la corrección" className="input w-64 text-xs" />
                      </Mini>
                    </details>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtNumero(l.saldo.retirado, 3)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtNumero(l.saldo.cargado, 3)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtNumero(l.saldo.devuelto, 3)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtNumero(l.saldo.diferencia, 3)}</td>
                <td className={`py-2 pr-3 text-right font-semibold tabular-nums ${l.saldo.pie > 0 ? "text-[var(--estado-bajo-fg)]" : ""}`}>{fmtNumero(l.saldo.pie, 3)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="text-xs text-foreground-muted">
              <td className="py-2 pr-3">Totales · sobrante mezclado reingresado: {fmtNumero(r.totales.sobrante, 3)} kg</td>
              <td className="py-2 pr-3 text-right">{fmtNumero(r.totales.retirado, 3)}</td>
              <td className="py-2 pr-3 text-right">{fmtNumero(r.totales.cargado, 3)}</td>
              <td className="py-2 pr-3 text-right">{fmtNumero(r.totales.devuelto, 3)}</td>
              <td className="py-2 pr-3 text-right">{fmtNumero(r.totales.diferencia, 3)}</td>
              <td className="py-2 pr-3 text-right font-semibold">{fmtNumero(r.totales.pie, 3)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {abierto && puedeOperar && r.totales.cargado > 0 && (
        <div className="rounded-md border border-border p-3">
          <div className="mb-1 text-xs font-medium text-foreground-muted">
            Sobrante mezclado (material con master que se saca de la tolva): entra al depósito con un código de sobrante o molienda.
          </div>
          <Mini accion={sobranteAction} boton="Registrar sobrante" ocultos={base}>
            <select name="materiaPrimaDestinoId" required defaultValue="" className="input w-80 text-xs" aria-label="Código de sobrante">
              <option value="" disabled>
                Código de sobrante / molienda…
              </option>
              {codigosSobrante.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
            <input name="cantidadKg" type="number" step="any" min="0" required placeholder="kg" className="input w-24 text-xs" aria-label="Kg de sobrante" />
          </Mini>
        </div>
      )}

      {abierto && puedeOperar && (
        <div className="rounded-md border border-border p-3">
          <div className="mb-1 text-xs font-medium text-foreground-muted">
            Cierre definitivo del retiro: requiere que no quede material a pie de máquina. Lo que no cierre se justifica (queda
            registrado como diferencia; no se modifica ninguna cantidad).
          </div>
          <Mini accion={cerrarRetiroAction} boton="Conciliar y cerrar retiro" ocultos={base}>
            {pendientes.map((l) => (
              <label key={l.id} className="block w-full text-xs text-foreground-muted">
                {l.materiaPrimaNombre}: quedan {fmtNumero(l.saldo.pie, 3)} kg — justificación
                <input name={`justificacion_${l.id}`} className="input mt-1 w-full text-xs" placeholder="ej. diferencia de balanza" />
              </label>
            ))}
          </Mini>
        </div>
      )}

      {r.movimientos.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground-muted">Movimientos del retiro</div>
          <ul className="space-y-1 text-sm">
            {r.movimientos.map((m) => {
              const linea = r.lineas.find((l) => l.id === m.retiroMpId);
              return (
                <li key={m.id} className={m.anulado ? "opacity-50" : ""}>
                  <span className="font-medium">{TIPO[m.tipo]}</span> · {fmtNumero(m.cantidad, 3)} kg
                  {linea ? ` de ${linea.materiaPrimaNombre}` : ""}
                  {m.destinoNombre ? ` → ${m.destinoNombre}` : ""}
                  {m.cicloId ? ` · ciclo #${m.cicloId}` : ""} · {m.usuarioNombre}, {fmtDia(m.fecha)} {new Date(m.fecha).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" })}
                  {m.observaciones && <span className="text-foreground-muted"> · {m.observaciones}</span>}
                  {m.anulado && <span className="text-[var(--estado-critico-fg)]"> · anulado: {m.anuladoMotivo}</span>}
                  {!m.anulado && puedeCorregir && (
                    <details className="inline-block pl-2 text-xs">
                      <summary className="cursor-pointer text-foreground-muted">anular</summary>
                      <Mini accion={anularMovimientoAction} boton="Anular" ocultos={{ ...base, movimientoId: m.id }}>
                        <input name="motivo" required placeholder="motivo de la corrección" className="input w-64 text-xs" />
                      </Mini>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
