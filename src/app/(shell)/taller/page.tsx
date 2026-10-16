import Link from "next/link";
import { getUsuarioActual } from "@/lib/session";
import { inyectorasActivas, vistaTaller, type MaterialEnMaquina, MOTIVOS_DIFERENCIA_RELEVO, MOTIVOS_EXCEPCION_CARGA, MOTIVOS_INTERRUPCION, MOTIVOS_NO_CARGA } from "@/lib/data/taller";
import { TURNOS, etiquetaTurno } from "@/lib/data/planificacion";
import { FormAccion } from "@/components/form-accion";
import { cargarRecetaAction, cerrarProduccionTallerAction, cerrarTurnoAction, novedadAction, tomarTurnoAction } from "@/app/actions/taller";
import { fmtFechaHora, fmtNumero } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";
import { CantidadesCarga, ElegirTurno, LectorCodigo, RecepcionRelevo, type ItemCarga } from "./componentes";
import type { Receta } from "@/lib/data/recetas";

/**
 * Mi turno — pantalla del operario, pensada para el celular (minuta
 * 15/10/2026): qué producir, cuánto falta, la receta en bolsas, el material
 * que hay, y el relevo. Sin datos administrativos.
 */
export default async function TallerPage({ searchParams }: { searchParams: Promise<{ iny?: string }> }) {
  const usuario = await getUsuarioActual();
  const sp = await searchParams;
  const activas = await inyectorasActivas();
  const iny = sp.iny && /^\d+$/.test(sp.iny) ? sp.iny : (activas[0]?.inyectora ?? "8");
  const v = await vistaTaller(iny);
  const p = v.produccion;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {activas.length > 1 && (
        <nav className="flex gap-2 overflow-x-auto pb-1">
          {activas.map((a) => (
            <Link key={a.inyectora} href={`/taller?iny=${a.inyectora}`} className={`btn btn-sm ${a.inyectora === iny ? "btn-azul" : "btn-outline"}`}>
              Inyectora {a.inyectora}
            </Link>
          ))}
        </nav>
      )}

      {!p ? (
        <section className="panel text-center">
          <h1 className="text-2xl">Inyectora {iny}</h1>
          <p className="mt-2 text-foreground-muted">No hay una producción en curso en esta máquina.</p>
          {v.proxima ? (
            <p className="aviso aviso-info mt-4">
              Próxima tanda: <b>{v.proxima.colorNombre}</b> · {v.proxima.productoDescripcion} · {fmtNumero(v.proxima.cantidad, 0)} piezas
              {v.proxima.turno ? ` · turno ${etiquetaTurno(v.proxima.turno)}` : ""}. La inicia el Encargado.
            </p>
          ) : (
            <p className="mt-4 text-sm text-foreground-muted">Cuando el Encargado inicie una producción, aparece acá con su receta.</p>
          )}
          {v.pie.length > 0 && <Materiales titulo="Material a pie de máquina" lista={v.pie} />}
        </section>
      ) : (
        <>
          {/* Qué producir */}
          <section className="panel">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-foreground-muted">
                  Inyectora {iny}
                  {p.turnoAbierto ? ` · Turno ${etiquetaTurno(p.turnoAbierto.turno)}` : ""}
                </div>
                <h1 className="mt-1 text-[1.7rem] leading-tight">{p.colorNombre ?? "—"}</h1>
                <div className="text-sm text-foreground-muted">
                  {p.productoDescripcion} · partida N° {p.partidaNumero ?? "—"}
                </div>
              </div>
              {p.turnoAbierto && <span className="badge-estado badge-ok">{p.turnoAbierto.operarioNombre ?? p.turnoAbierto.usuarioNombre}</span>}
            </div>
            <Progreso producido={p.producido} objetivo={p.objetivo} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Cifra valor={fmtNumero(p.producido, 0)} label="producidas" />
              <Cifra valor={p.objetivo != null ? fmtNumero(p.objetivo, 0) : "—"} label="a producir" />
              <Cifra valor={p.falta != null ? fmtNumero(p.falta, 0) : "—"} label={p.golpesFaltantes != null ? `faltan (${fmtNumero(p.golpesFaltantes, 0)} golpes)` : "faltan"} destacar />
            </div>
          </section>

          {!p.turnoAbierto ? (
            <TomarTurno p={p} pie={v.pie} usuarioNombre={usuario.nombre} />
          ) : (
            <>
              <CargarTolva p={p} />
              <section className="panel">
                <h2 className="panel-titulo">Leer bolsa</h2>
                <LectorCodigo productoNumero={p.productoNumero} materialesReceta={[...(p.receta?.items ?? []), ...(p.recetaArranque?.items ?? [])].map((i) => i.materiaPrimaId)} />
              </section>
              <section className="panel">
                <h2 className="panel-titulo">Material</h2>
                <Materiales titulo="A pie de máquina" lista={v.pie} vacio="No hay material a pie de máquina: pedí el retiro." />
                <Materiales titulo="Cargado en la tolva (esta producción)" lista={p.tolva} vacio="Todavía no se cargó." />
                <p className="mt-2 text-xs text-foreground-muted">
                  En este turno: {p.cargasDelTurno} registro{p.cargasDelTurno === 1 ? "" : "s"} de carga · {fmtPeso(p.kgCargadosTurno)}
                </p>
              </section>
              <CerrarTurno p={p} />
            </>
          )}

          {p.novedades.length > 0 && (
            <section className="panel">
              <h2 className="panel-titulo">Novedades de esta producción</h2>
              <ul className="space-y-1.5 text-sm">
                {p.novedades.map((n) => (
                  <li key={n.id}>
                    <b>{n.motivo}</b>
                    {n.detalle ? ` · ${n.detalle}` : ""} <span className="text-xs text-foreground-muted">({fmtFechaHora(n.fecha)})</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

type Prod = NonNullable<Awaited<ReturnType<typeof vistaTaller>>["produccion"]>;
type Mat = readonly MaterialEnMaquina[];

function Cifra({ valor, label, destacar }: { valor: string; label: string; destacar?: boolean }) {
  return (
    <div className={`rounded-xl p-2 ${destacar ? "bg-[rgba(238,125,48,0.1)]" : "bg-surface-muted"}`}>
      <div className={`font-[family-name:var(--font-display)] text-2xl font-bold ${destacar ? "text-[#b4521a]" : ""}`}>{valor}</div>
      <div className="text-[11px] font-semibold text-foreground-muted">{label}</div>
    </div>
  );
}

function Progreso({ producido, objetivo }: { producido: number; objetivo: number | null }) {
  if (!objetivo) return null;
  const pct = Math.min(100, Math.round((producido / objetivo) * 100));
  return (
    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-muted" aria-label={`${pct}% producido`}>
      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Materiales({ titulo, lista, vacio }: { titulo: string; lista: Mat; vacio?: string }) {
  return (
    <div className="mt-3 text-left">
      <div className="text-xs font-bold uppercase tracking-wide text-foreground-muted">{titulo}</div>
      {lista.length === 0 ? (
        <p className="text-sm text-foreground-muted">{vacio ?? "Nada."}</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {lista.map((m) => (
            <li key={m.materiaPrimaId} className="flex justify-between gap-3">
              <span>{m.nombre}</span>
              <span className="text-right font-semibold">{m.bolsas ?? fmtPeso(m.kg, { gramos: m.esMaster })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TomarTurno({ p, pie, usuarioNombre }: { p: Prod; pie: Mat; usuarioNombre: string }) {
  const u = p.ultimoTurno;
  return (
    <section className="panel space-y-4">
      <h2 className="panel-titulo">Empezar mi turno</h2>
      {u && (
        <div className="rounded-xl bg-surface-muted p-3 text-sm">
          <div className="font-semibold">
            Relevo del turno {etiquetaTurno(u.turno)} ({u.operarioNombre ?? u.usuarioNombre})
          </div>
          <div>
            Golpes al relevo: <b>{u.golpesFin != null ? fmtNumero(u.golpesFin, 0) : "—"}</b> · piezas del turno: <b>{u.piezas ?? "—"}</b> · descarte: {fmtPeso(Number(u.descarteKg ?? 0))}
          </div>
          {u.motivoInterrupcion && <div>Interrupción: {u.motivoInterrupcion}</div>}
          {u.observaciones && <div>Indicaciones: {u.observaciones}</div>}
          <Materiales titulo="Material que recibís a pie de máquina" lista={pie} vacio="No queda material a pie de máquina." />
          <Materiales titulo="En la tolva" lista={p.tolva} vacio="Nada registrado en la tolva." />
        </div>
      )}
      <FormAccion accion={tomarTurnoAction} ocultos={{ cicloId: p.cicloId }} boton="Tomar el turno" claseBoton="btn btn-primary btn-lg btn-block" className="space-y-4">
        <div className="campo">
          <span>Turno</span>
          <ElegirTurno turnos={TURNOS} />
        </div>
        {u && (
          <div className="campo">
            <span>¿El material que recibís coincide con lo informado?</span>
            <RecepcionRelevo motivos={MOTIVOS_DIFERENCIA_RELEVO} />
          </div>
        )}
        <label className="campo">
          <span>Tu nombre</span>
          <input name="operarioNombre" defaultValue={usuarioNombre === "Taller" ? "" : usuarioNombre} placeholder="Quién trabaja en este turno" className="input" />
        </label>
        <label className="campo">
          <span>Golpes que marca la máquina ahora</span>
          <input name="golpesInicio" inputMode="numeric" defaultValue={u?.golpesFin ?? p.golpesInicioProduccion ?? ""} className="input text-lg" />
          <span className="campo-ayuda">Ya viene del relevo anterior; cambialo sólo si la máquina marca otro número.</span>
        </label>
      </FormAccion>
    </section>
  );
}

function itemsDe(r: Receta): ItemCarga[] {
  return r.items.map((i) => ({ materiaPrimaId: i.materiaPrimaId, presentacionId: i.presentacionId, nombre: i.materiaPrimaNombre, presentacion: i.presentacionNombre, kgPres: i.kgPresentacion, cantidad: i.cantidad, esMaster: i.esMaster }));
}

function CargarTolva({ p }: { p: Prod }) {
  const receta = p.usarArranque && p.recetaArranque ? p.recetaArranque : p.receta;
  const tipo = p.usarArranque && p.recetaArranque ? "ARRANQUE" : "REGIMEN";
  if (!receta) {
    return (
      <section className="panel">
        <h2 className="panel-titulo">Cargar la tolva</h2>
        <p className="aviso aviso-alerta">Este producto no tiene receta de carga. Avisale al Encargado para que la defina.</p>
      </section>
    );
  }
  return (
    <section className="panel space-y-4">
      <h2 className="panel-titulo">{tipo === "ARRANQUE" ? "Cargar la tolva · arranque por cambio de color" : "Cargar la tolva"}</h2>
      <ul className="space-y-2">
        {receta.items.map((i) => (
          <li key={`${i.materiaPrimaId}-${i.presentacionId}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white px-3 py-2.5">
            <span className="font-[family-name:var(--font-display)] text-xl font-bold">{i.texto}</span>
            <span className="text-right text-sm text-foreground-muted">{i.materiaPrimaNombre}</span>
          </li>
        ))}
      </ul>
      <FormAccion accion={cargarRecetaAction} ocultos={{ cicloId: p.cicloId, tipo }} boton="Cargué la tanda completa" claseBoton="btn btn-primary btn-lg btn-block" className="space-y-2" />
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer font-semibold">Cargué distinto</summary>
        <FormAccion accion={cargarRecetaAction} ocultos={{ cicloId: p.cicloId, tipo }} boton="Registrar lo que cargué" claseBoton="btn btn-azul btn-block" className="mt-3 space-y-3">
          <CantidadesCarga items={itemsDe(receta)} />
          <select name="motivo" required defaultValue="" className="input">
            <option value="" disabled>
              ¿Por qué?
            </option>
            {MOTIVOS_EXCEPCION_CARGA.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </FormAccion>
      </details>
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer font-semibold">No pude cargar</summary>
        <FormAccion accion={novedadAction} ocultos={{ cicloId: p.cicloId, tipo: "NO_CARGA" }} boton="Registrar" claseBoton="btn btn-outline btn-block" className="mt-3 space-y-2">
          <select name="motivo" required defaultValue="" className="input">
            <option value="" disabled>
              ¿Por qué?
            </option>
            {MOTIVOS_NO_CARGA.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input name="detalle" placeholder="Detalle (opcional)" className="input" />
        </FormAccion>
      </details>
      {p.usarArranque && p.receta && <p className="text-xs text-foreground-muted">Después del arranque, la pantalla pasa sola a la receta normal.</p>}
    </section>
  );
}

function CerrarTurno({ p }: { p: Prod }) {
  return (
    <section className="panel space-y-3">
      <h2 className="panel-titulo">Terminar mi turno</h2>
      <FormAccion accion={cerrarTurnoAction} ocultos={{ cicloId: p.cicloId }} boton="Cerrar turno y dejar el relevo" claseBoton="btn btn-azul btn-lg btn-block" className="space-y-3">
        <label className="campo">
          <span>Golpes que marca la máquina</span>
          <input name="golpesFin" inputMode="numeric" required className="input text-lg" />
          <span className="campo-ayuda">Al empezar el turno marcaba {p.turnoAbierto?.golpesInicio != null ? fmtNumero(p.turnoAbierto.golpesInicio, 0) : "—"}.</span>
        </label>
        <label className="campo">
          <span>Descarte pesado (kg)</span>
          <input name="descarteKg" inputMode="decimal" placeholder="0" className="input" />
        </label>
        <label className="campo">
          <span>¿Hubo interrupciones?</span>
          <select name="motivoInterrupcion" defaultValue="Sin interrupciones" className="input">
            {MOTIVOS_INTERRUPCION.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Indicaciones para el que entra (opcional)</span>
          <input name="observaciones" className="input" />
        </label>
      </FormAccion>
      <details className="rounded-xl border border-border p-3">
        <summary className="cursor-pointer font-semibold">Terminó la producción (no sigue en el turno siguiente)</summary>
        <FormAccion
          accion={cerrarProduccionTallerAction}
          ocultos={{ cicloId: p.cicloId }}
          boton="Cerrar la producción"
          claseBoton="btn btn-primary btn-block"
          confirmar="¿Cerrar la producción? Lo producido entra a stock y no se puede seguir cargando en esta tanda."
          className="mt-3 space-y-3"
        >
          <label className="campo">
            <span>Golpes que marca la máquina</span>
            <input name="golpesFin" inputMode="numeric" required className="input text-lg" />
          </label>
          <label className="campo">
            <span>Descarte pesado de este turno (kg)</span>
            <input name="descarteKg" inputMode="decimal" placeholder="0" className="input" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="campo">
              <span>Rebarba (kg)</span>
              <input name="rebarbaKg" inputMode="decimal" placeholder="opcional" className="input" />
            </label>
            <label className="campo">
              <span>Scrap (kg)</span>
              <input name="scrapKg" inputMode="decimal" placeholder="opcional" className="input" />
            </label>
          </div>
          <p className="campo-ayuda">La colada se calcula sola. Lo que entra a stock es lo producido menos el descarte.</p>
        </FormAccion>
      </details>
    </section>
  );
}
