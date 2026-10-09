"use client";

import { useActionState, useState, useTransition } from "react";
import { crearCicloAction, datosParaProducto, type FormState } from "@/app/actions/produccion";
import type { ResumenParaCiclo } from "@/lib/data/produccion";
import { fmtFecha, fmtNumero, hoyISO } from "@/lib/format";
import { INYECTORAS, INYECTORA_BALDOSAS } from "@/lib/inyectoras";

type Producto = { id: number; codigo: string; descripcion: string; esAccesorio: boolean };
type Operario = { id: number; nombre: string };
type Resumen = NonNullable<ResumenParaCiclo>;

const NUEVA = "nueva";

/**
 * Inicio de la producción del día. Orden: qué se produce → máquina → partida
 * (la continúa si hay una abierta; si no, el sistema le da el número) → para
 * qué pedidos. La materia prima se retira después, desde el ciclo creado.
 */
export function FormularioCiclo({
  productos,
  operarios,
  productoIdInicial,
  datosIniciales,
}: {
  productos: Producto[];
  operarios: Operario[];
  productoIdInicial: number | null;
  datosIniciales: Resumen | null;
}) {
  const [state, formAction, pendiente] = useActionState<FormState, FormData>(crearCicloAction, {});
  const [cargando, startTransition] = useTransition();

  const [productoId, setProductoId] = useState<number | null>(productoIdInicial);
  const [resumen, setResumen] = useState<Resumen | null>(datosIniciales);
  const [partida, setPartida] = useState<string>(partidaPorDefecto(datosIniciales));
  const [golpesInicio, setGolpesInicio] = useState<string>(golpesDe(datosIniciales, partidaPorDefecto(datosIniciales)));
  const [piezasPorGolpe, setPiezasPorGolpe] = useState<string>(datosIniciales?.piezasPorGolpe?.toString() ?? "");
  const [plan, setPlan] = useState<Record<number, { incluido: boolean; cantidad: number }>>(planInicial(datosIniciales));
  const [deseada, setDeseada] = useState<string>(datosIniciales && datosIniciales.recomendado > 0 ? String(datosIniciales.recomendado) : "");

  function elegirProducto(idTexto: string) {
    const id = idTexto ? Number(idTexto) : null;
    setProductoId(id);
    setResumen(null);
    if (!id) return;
    startTransition(async () => {
      const r = await datosParaProducto(id);
      setResumen(r);
      const p = partidaPorDefecto(r);
      setPartida(p);
      setGolpesInicio(golpesDe(r, p));
      setPiezasPorGolpe(r?.piezasPorGolpe?.toString() ?? "");
      setPlan(planInicial(r));
      setDeseada(r && r.recomendado > 0 ? String(r.recomendado) : "");
    });
  }

  function elegirPartida(valor: string) {
    setPartida(valor);
    setGolpesInicio(golpesDe(resumen, valor));
  }

  const partidaElegida = resumen?.partidas.find((p) => String(p.id) === partida);
  const planificado = Object.values(plan).reduce((t, l) => t + (l.incluido ? l.cantidad || 0 : 0), 0);

  return (
    <form action={formAction} className="space-y-5 rounded-lg border border-border bg-surface p-4">
      {state.error && (
        <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">
          {state.error}
        </div>
      )}

      <Paso n={1} titulo="Qué se produce">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <Campo label="Fecha">
            <input name="fecha" type="date" required defaultValue={hoyISO()} className="input" />
          </Campo>
          <Campo label="Producto (tipo y color)">
            <select name="productoId" required className="input" value={productoId ?? ""} onChange={(e) => elegirProducto(e.target.value)}>
              <option value="" disabled>
                Elegí un producto…
              </option>
              {productos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} · {p.descripcion}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        {cargando && <p className="text-sm text-foreground-muted">Cargando datos del producto…</p>}
        {resumen && (
          <p className="rounded-md bg-surface-muted px-3 py-2 text-sm">
            {resumen.esAccesorio ? "Accesorio" : "Baldosa"}
            {resumen.familia ? ` · ${resumen.familia === "REJILLA" ? "Rejilla" : "Ciego"}` : ""} · Color: {resumen.colorNombre ?? "—"}
            {resumen.material && (
              <>
                {" "}
                · Material base: {resumen.material.nombre ?? "sin definir"} · Master: {fmtNumero(resumen.material.gPorKgMp, 4)} g/kg
              </>
            )}
          </p>
        )}
      </Paso>

      {productoId && resumen && (
        <>
          <Paso n={2} titulo="Máquina">
            {resumen.esAccesorio ? (
              <Campo label="Inyectora">
                <select name="inyectora" required defaultValue="" className="input sm:w-56">
                  <option value="" disabled>
                    Elegí la inyectora…
                  </option>
                  {INYECTORAS.map((n) => (
                    <option key={n} value={n}>
                      Inyectora {n}
                    </option>
                  ))}
                </select>
              </Campo>
            ) : (
              <p className="text-sm">
                <input type="hidden" name="inyectora" value={INYECTORA_BALDOSAS} />
                <span className="font-medium">Inyectora {INYECTORA_BALDOSAS}</span>
                <span className="text-foreground-muted"> — las baldosas se producen siempre en esta máquina.</span>
              </p>
            )}
          </Paso>

          <Paso n={3} titulo="Partida">
            {resumen.partidas.length > 0 ? (
              <Campo label="La partida agrupa lo producido con este producto (material y color), aunque se cierre cada día">
                <select name="partidaId" className="input" value={partida} onChange={(e) => elegirPartida(e.target.value)}>
                  {resumen.partidas.map((p) => (
                    <option key={p.id} value={p.id}>
                      Continuar la partida N° {p.numero} (abierta el {fmtFecha(p.fechaApertura)})
                    </option>
                  ))}
                  <option value={NUEVA}>Iniciar una partida nueva — se le asigna el N° {resumen.siguientePartida}</option>
                </select>
              </Campo>
            ) : (
              <p className="text-sm">
                <input type="hidden" name="partidaId" value={NUEVA} />
                <span className="font-medium">Partida nueva N° {resumen.siguientePartida}</span>
                <span className="text-foreground-muted">
                  {" "}
                  — el número lo asigna el sistema (no hay una partida abierta de este producto).
                </span>
              </p>
            )}
            {partidaElegida?.ultimoCicloAbierto && (
              <p className="text-sm text-[var(--estado-critico-fg)]">
                Esta partida tiene un ciclo sin cerrar: cerralo antes de continuarla (los golpes de inicio salen de ese cierre).
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo label="Golpes de inicio">
                <input
                  name="golpesInicio"
                  type="number"
                  className="input"
                  value={golpesInicio}
                  onChange={(e) => setGolpesInicio(e.target.value)}
                />
              </Campo>
              <Campo label="Piezas por golpe">
                <input name="piezasPorGolpe" type="number" className="input" value={piezasPorGolpe} onChange={(e) => setPiezasPorGolpe(e.target.value)} />
              </Campo>
              <Campo label="Ciclo (segundos)">
                <input name="cicloSegundos" type="number" step="0.1" className="input" />
              </Campo>
              <Campo label="Operario">
                <select name="operarioId" className="input" defaultValue="">
                  <option value="">—</option>
                  {operarios.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.nombre}
                    </option>
                  ))}
                </select>
              </Campo>
            </div>
            {partidaElegida && partidaElegida.ultimoGolpesFin != null && (
              <p className="text-xs text-foreground-muted">Golpes de inicio = golpes de fin del último cierre de esta partida.</p>
            )}
            <Campo label="Modo">
              <input name="modo" className="input" placeholder="opcional" />
            </Campo>
          </Paso>

          <Paso n={4} titulo="Cuánto se produce">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <Cifra label="1. Necesidad de pedidos" valor={resumen.faltaProducir} destacado={resumen.faltaProducir > 0} />
              <div className="rounded-md bg-surface-muted px-3 py-2">
                <div className="text-xs text-foreground-muted">2. Reposición hasta el mínimo</div>
                <div className="text-base font-semibold">{resumen.reposicion != null ? fmtNumero(resumen.reposicion, 0) : "—"}</div>
                <div className="text-[11px] text-foreground-muted">
                  {resumen.minimo != null && resumen.minimo > 0 ? `mínimo ${fmtNumero(resumen.minimo, 0)}` : "sin mínimo configurado"}
                </div>
              </div>
              <Cifra label="Recomendado (1 + 2)" valor={resumen.recomendado} />
              <Campo label="3. Inyección deseada">
                <input
                  name="cantidadDeseada"
                  type="number"
                  min={1}
                  className="input"
                  value={deseada}
                  onChange={(e) => setDeseada(e.target.value)}
                  placeholder={resumen.recomendado > 0 ? String(resumen.recomendado) : "piezas"}
                />
              </Campo>
            </div>
            <p className="text-xs text-foreground-muted">
              Pendiente de los pedidos {fmtNumero(resumen.pendientePedidos, 0)} · stock actual {fmtNumero(resumen.stock, 0)}. La inyección
              deseada es la decisión de planificación: puede ser mayor o menor que lo recomendado.
              {Number(deseada) > 0 &&
                (resumen.kgPorUnidad
                  ? ` Material estimado: ${fmtNumero(Number(deseada) * resumen.kgPorUnidad, 1)} kg${
                      resumen.material ? ` y ${fmtNumero(Number(deseada) * resumen.kgPorUnidad * resumen.material.gPorKgMp, 3)} g de master (dosificación configurada)` : ""
                    }.`
                  : " Sin peso por pieza configurado: no se puede estimar el material.")}
            </p>
            {resumen.pedidos.length > 0 && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="text-xs text-foreground-muted">
                  Marcá los pedidos que busca cubrir esta tirada (orden de prioridad). Es la planificación: no reserva nada.
                </p>
                {resumen.pedidos.map((p) => {
                  const linea = plan[p.pedidoId];
                  return (
                    <div key={p.pedidoId} className="flex flex-wrap items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        aria-label={`Planificar pedido ${p.pedidoId}`}
                        checked={linea?.incluido ?? false}
                        onChange={(e) => setPlan((prev) => ({ ...prev, [p.pedidoId]: { ...prev[p.pedidoId], incluido: e.target.checked } }))}
                      />
                      <span className="flex-1 text-foreground-muted">
                        Pedido #{p.pedidoId} · {p.clienteNombre} — pendiente {fmtNumero(p.cantidad, 0)}
                      </span>
                      {linea?.incluido && (
                        <label className="flex items-center gap-1 text-xs text-foreground-muted">
                          <input type="hidden" name="pedidoId" value={p.pedidoId} />
                          planificado
                          <input
                            type="number"
                            name="cantidadAsignada"
                            min={1}
                            className="input w-24"
                            value={linea.cantidad}
                            onChange={(e) => setPlan((prev) => ({ ...prev, [p.pedidoId]: { ...prev[p.pedidoId], cantidad: Number(e.target.value) } }))}
                          />
                        </label>
                      )}
                    </div>
                  );
                })}
                {planificado > 0 && <p className="text-xs text-foreground-muted">Planificado para pedidos: {fmtNumero(planificado, 0)} piezas.</p>}
              </div>
            )}
            <p className="text-xs text-foreground-muted">
              Al cerrar la jornada, todo lo producido entra al stock en cajas. Cada pedido toma sus unidades del stock cuando se
              arma su despacho; si se produce más de lo que falta, el excedente queda como stock libre.
            </p>
          </Paso>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pendiente || !productoId || !resumen || Boolean(partidaElegida?.ultimoCicloAbierto)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
        >
          Iniciar producción
        </button>
        <span className="text-xs text-foreground-muted">Después: retirar la materia prima para este ciclo y, al terminar el día, cargar el cierre.</span>
      </div>
    </form>
  );
}

function partidaPorDefecto(r: Resumen | null): string {
  return r?.partidas[0] ? String(r.partidas[0].id) : NUEVA;
}

function golpesDe(r: Resumen | null, partida: string): string {
  const p = r?.partidas.find((x) => String(x.id) === partida);
  // Contador de la máquina: al continuar, el del último cierre; si no, la lectura del día.
  return p?.ultimoGolpesFin != null ? String(p.ultimoGolpesFin) : "";
}

function planInicial(r: Resumen | null) {
  return Object.fromEntries((r?.pedidos ?? []).map((p) => [p.pedidoId, { incluido: false, cantidad: p.cantidad }]));
}

function Paso({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-foreground">
        <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent text-xs text-accent-foreground">{n}</span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-foreground-muted">{label}</span>
      {children}
    </label>
  );
}

function Cifra({ label, valor, destacado }: { label: string; valor: number; destacado?: boolean }) {
  return (
    <div className="rounded-md bg-surface-muted px-3 py-2">
      <div className="text-xs text-foreground-muted">{label}</div>
      <div className={`text-base font-semibold ${destacado ? "text-[var(--estado-critico-fg)]" : ""}`}>{fmtNumero(valor, 0)}</div>
    </div>
  );
}
