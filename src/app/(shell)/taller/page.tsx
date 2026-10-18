import Link from "next/link";
import { getUsuarioActual } from "@/lib/session";
import {
  eventosDe,
  inyectorasActivas,
  turnoActual,
  vistaTaller,
  type MaterialEnMaquina,
  MOTIVOS_DIFERENCIA_RELEVO,
  MOTIVOS_EXCEPCION_CARGA,
  MOTIVOS_INTERRUPCION,
  MOTIVOS_NO_CARGA,
} from "@/lib/data/taller";
import { TURNOS, etiquetaTurno, ultimosGolpes } from "@/lib/data/planificacion";
import { codigosDeSobrante } from "@/lib/data/maquina";
import { FormAccion } from "@/components/form-accion";
import {
  cancelarProduccionAction,
  cargarRecetaAction,
  cerrarProduccionTallerAction,
  cerrarTurnoAction,
  iniciarTandaAction,
  novedadAction,
  pausarAction,
  tomarTurnoAction,
} from "@/app/actions/taller";
import { fmtFecha, fmtFechaHora, fmtNumero } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";
import { CargaTolva, DosBotonesCierre, ElegirTurno, RecepcionRelevo, type ItemCarga } from "./componentes";
import type { Receta } from "@/lib/data/recetas";

/**
 * Mi turno — pantalla del operario (celular). Listado de mejoras:
 *  - al entrar elige la máquina en la que trabaja (las disponibles);
 *  - inicia la tanda que le asignó el Encargado anotando los golpes;
 *  - el turno sale de la hora (horarios en Parámetros) y el responsable es el
 *    usuario autenticado;
 *  - registra la carga en tolva en un solo paso, con la receta precargada;
 *  - puede pausar, cancelar o finalizar, y deja el relevo con dos botones.
 */
export default async function TallerPage({ searchParams }: { searchParams: Promise<{ iny?: string }> }) {
  const usuario = await getUsuarioActual();
  const sp = await searchParams;
  const [activas, turno] = await Promise.all([inyectorasActivas(), turnoActual()]);
  const iny = sp.iny && /^\d+$/.test(sp.iny) ? sp.iny : activas.length === 1 ? activas[0].inyectora : null;

  if (!iny) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <section className="panel">
          <h1 className="text-2xl">¿En qué máquina vas a trabajar?</h1>
          <p className="mt-1 text-sm text-foreground-muted">
            {turno ? `Turno ${etiquetaTurno(turno.turno)}` : "Turno: los horarios todavía no están configurados"} · {usuario.nombre}
          </p>
          {activas.length === 0 ? (
            <p className="aviso aviso-info mt-4">No hay producciones en curso ni tandas asignadas. Cuando el Encargado asigne una tanda a una máquina, aparece acá.</p>
          ) : (
            <ul className="mt-4 space-y-2">
              {activas.map((a) => (
                <li key={a.inyectora}>
                  <Link href={`/taller?iny=${a.inyectora}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white p-4 hover:border-accent">
                    <span>
                      <span className="block font-[family-name:var(--font-display)] text-xl font-bold text-brand-azul">Inyectora {a.inyectora}</span>
                      <span className="block text-sm text-foreground-muted">{a.detalle}</span>
                    </span>
                    <span className="btn btn-primary btn-sm">Elegir</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  const v = await vistaTaller(iny);
  const p = v.produccion;
  const [golpes, sobrantes, eventos] = await Promise.all([ultimosGolpes(iny), p ? codigosDeSobrante() : Promise.resolve([]), p ? eventosDe(p.cicloId) : Promise.resolve([])]);
  const pausa = p?.pausada ? [...eventos].reverse().find((e) => e.e.tipo === "PAUSA") : null;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Link href="/taller" className="btn btn-ghost btn-sm">
          ← Cambiar de máquina
        </Link>
        <span className="text-xs font-semibold text-foreground-muted">
          {turno ? `Turno ${etiquetaTurno(turno.turno)}` : "Horarios de turno sin configurar"} · {usuario.nombre}
        </span>
      </div>

      {!p ? (
        <SinProduccion v={v} iny={iny} golpes={golpes} turnoAuto={Boolean(turno)} usuarioNombre={usuario.nombre} />
      ) : (
        <>
          <section className="panel">
            <div className="text-xs font-bold uppercase tracking-wider text-foreground-muted">
              Inyectora {iny}
              {p.turnoAbierto ? ` · Turno ${etiquetaTurno(p.turnoAbierto.turno)} · ${p.turnoAbierto.operarioNombre ?? p.turnoAbierto.usuarioNombre}` : " · sin turno tomado"}
            </div>
            <h1 className="mt-1 text-[1.7rem] leading-tight">{p.colorNombre ?? "—"}</h1>
            <div className="text-sm text-foreground-muted">
              {p.productoDescripcion} · partida N° {p.partidaNumero ?? "—"} · {p.piezasPorGolpe} pieza{p.piezasPorGolpe === 1 ? "" : "s"} por golpe
            </div>
            <Progreso producido={p.producido} objetivo={p.objetivo} />
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <Cifra valor={fmtNumero(p.producido, 0)} label="producidas" />
              <Cifra valor={p.objetivo != null ? fmtNumero(p.objetivo, 0) : "—"} label="a producir" />
              <Cifra valor={p.falta != null ? fmtNumero(p.falta, 0) : "—"} label={p.golpesFaltantes != null ? `faltan (${fmtNumero(p.golpesFaltantes, 0)} golpes)` : "faltan"} destacar />
            </div>
            {p.pausada && (
              <div className="aviso aviso-alerta mt-3 flex flex-wrap items-center justify-between gap-2">
                <span>
                  <b>Producción pausada</b>
                  {pausa?.e.motivo ? `: ${pausa.e.motivo}` : ""}
                </span>
                <FormAccion accion={pausarAction} ocultos={{ cicloId: p.cicloId, reanudar: 1 }} boton="Reanudar" claseBoton="btn btn-azul btn-sm" className="flex" />
              </div>
            )}
          </section>

          {!p.turnoAbierto ? (
            <Retomar p={p} pie={v.pie} usuarioNombre={usuario.nombre} turnoAuto={Boolean(turno)} />
          ) : (
            <>
              {!p.pausada && <RegistrarCarga p={p} pie={v.pie} />}
              <section className="panel">
                <h2 className="panel-titulo">Material</h2>
                <Materiales titulo="A pie de máquina" lista={v.pie} vacio="No hay material a pie de máquina." />
                <Materiales titulo="Cargado en la tolva (esta producción)" lista={p.tolva} vacio="Todavía no se cargó." />
              </section>
              <section className="panel space-y-3">
                <h2 className="panel-titulo">Terminar</h2>
                <DosBotonesCierre relevo={<FormRelevo p={p} />} finalizar={<FormFinalizar p={p} sobrantes={sobrantes} />} />
                <div className="grid gap-2 sm:grid-cols-2">
                  {!p.pausada && (
                    <details className="rounded-xl border border-border p-3">
                      <summary className="cursor-pointer font-semibold">Pausar producción</summary>
                      <FormAccion accion={pausarAction} ocultos={{ cicloId: p.cicloId }} boton="Pausar" claseBoton="btn btn-outline btn-block" className="mt-2 space-y-2">
                        <select name="motivo" required defaultValue="" className="input">
                          <option value="" disabled>
                            Motivo…
                          </option>
                          {MOTIVOS_NO_CARGA.map((m) => (
                            <option key={m}>{m}</option>
                          ))}
                        </select>
                      </FormAccion>
                    </details>
                  )}
                  <details className="rounded-xl border border-border p-3">
                    <summary className="cursor-pointer font-semibold">Cancelar producción</summary>
                    <p className="mt-2 text-xs text-foreground-muted">Sólo si todavía no se produjo nada. La tanda vuelve a la planificación.</p>
                    <FormAccion
                      accion={cancelarProduccionAction}
                      ocultos={{ cicloId: p.cicloId }}
                      boton="Cancelar la producción"
                      claseBoton="btn btn-outline btn-block"
                      confirmar="¿Cancelar la producción? La tanda vuelve a la planificación."
                      className="mt-2 space-y-2"
                    >
                      <input name="motivo" required placeholder="Motivo" className="input" />
                    </FormAccion>
                  </details>
                </div>
              </section>
            </>
          )}

          {(p.novedades.length > 0 || eventos.length > 0) && (
            <section className="panel">
              <h2 className="panel-titulo">Historial de esta producción</h2>
              <ul className="space-y-1.5 text-sm">
                {eventos.map(({ e, usuarioNombre }) => (
                  <li key={`e${e.id}`}>
                    <b>{{ INICIO: "Inicio", PAUSA: "Pausa", REANUDACION: "Reanudación", CANCELACION: "Cancelación", FINALIZACION: "Finalización" }[e.tipo]}</b>
                    {e.motivo ? ` · ${e.motivo}` : ""} <span className="text-xs text-foreground-muted">({fmtFechaHora(e.fecha)} · {usuarioNombre})</span>
                  </li>
                ))}
                {/* La pausa ya figura como evento: su novedad (para supervisión) no se repite acá. */}
                {p.novedades.filter((n) => !n.motivo.startsWith("Pausa: ")).map((n) => (
                  <li key={`n${n.id}`}>
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

type Vista = Awaited<ReturnType<typeof vistaTaller>>;
type Prod = NonNullable<Vista["produccion"]>;
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

/** Sin producción en curso: la tanda asignada por el Encargado, para iniciarla. */
function SinProduccion({ v, iny, golpes, turnoAuto, usuarioNombre }: { v: Vista; iny: string; golpes: number | null; turnoAuto: boolean; usuarioNombre: string }) {
  const t = v.asignadas[0];
  return (
    <section className="panel space-y-4">
      <h1 className="text-2xl">Inyectora {iny}</h1>
      {!t ? (
        <p className="aviso aviso-info">No hay ninguna tanda asignada a esta máquina. Cuando el Encargado asigne una, aparece acá para iniciarla.</p>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-white p-3">
            <div className="text-xs font-bold uppercase tracking-wide text-foreground-muted">
              Tanda asignada{t.fecha ? ` · ${fmtFecha(t.fecha)}` : ""}
              {t.turno ? ` · turno ${etiquetaTurno(t.turno)}` : ""}
            </div>
            <div className="mt-1 flex items-center gap-2">
              {t.colorHex && <span className="h-5 w-5 rounded border border-[rgba(29,43,58,0.2)]" style={{ background: t.colorHex }} />}
              <span className="font-[family-name:var(--font-display)] text-xl font-bold">{t.colorNombre}</span>
            </div>
            <div className="text-sm text-foreground-muted">
              {t.productoDescripcion} · {fmtNumero(t.cantidad, 0)} piezas · {t.piezasPorGolpe ?? 1} por golpe
            </div>
            {t.receta ? (
              <div className="mt-2 text-sm">Receta: {t.receta.items.map((i) => `${i.texto} ${i.materiaPrimaNombre}`).join(" + ")}</div>
            ) : (
              <p className="aviso aviso-alerta mt-2 text-sm">Esta tanda no tiene receta de carga: avisale al Encargado.</p>
            )}
            {t.observaciones && <p className="mt-2 text-sm">Indicaciones: {t.observaciones}</p>}
          </div>
          <FormAccion accion={iniciarTandaAction} ocultos={{ tandaId: t.id }} boton="Iniciar producción" claseBoton="btn btn-primary btn-lg btn-block" className="space-y-3">
            <label className="campo">
              <span>Golpes que marca la máquina al iniciar</span>
              <input name="golpesInicio" inputMode="numeric" required defaultValue={golpes ?? ""} className="input text-lg" />
              {golpes != null && <span className="campo-ayuda">Último registro de esta máquina: {fmtNumero(golpes, 0)}.</span>}
            </label>
            <NombreOperario usuarioNombre={usuarioNombre} />
            {!turnoAuto && (
              <div className="campo">
                <span>Turno (los horarios no están configurados)</span>
                <ElegirTurno turnos={TURNOS} sugerido={t.turno} />
              </div>
            )}
          </FormAccion>
          {v.asignadas.length > 1 && <p className="text-xs text-foreground-muted">Después siguen {v.asignadas.length - 1} tanda(s) más en esta máquina.</p>}
        </>
      )}
      {v.pie.length > 0 && <Materiales titulo="Material a pie de máquina" lista={v.pie} />}
    </section>
  );
}

/** Turno entrante: ve lo que recibe y lo que falta, y acepta el relevo. */
function Retomar({ p, pie, usuarioNombre, turnoAuto }: { p: Prod; pie: Mat; usuarioNombre: string; turnoAuto: boolean }) {
  const u = p.ultimoTurno;
  return (
    <section className="panel space-y-4">
      <h2 className="panel-titulo">Retomar la máquina</h2>
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
          {u.materialAlCierre && <div className="mt-1">Informado al cierre: {u.materialAlCierre}</div>}
          <div className="mt-1">Queda por producir: <b>{p.falta != null ? `${fmtNumero(p.falta, 0)} piezas` : "—"}</b></div>
        </div>
      )}
      <Materiales titulo="Material que recibís a pie de máquina (según el sistema)" lista={pie} vacio="No queda material a pie de máquina." />
      <Materiales titulo="En la tolva" lista={p.tolva} vacio="Nada registrado en la tolva." />
      <FormAccion accion={tomarTurnoAction} ocultos={{ cicloId: p.cicloId }} boton="Aceptar el relevo y empezar mi turno" claseBoton="btn btn-primary btn-lg btn-block" className="space-y-4">
        {u && (
          <div className="campo">
            <span>¿El material que recibís coincide con lo informado?</span>
            <RecepcionRelevo motivos={MOTIVOS_DIFERENCIA_RELEVO} />
          </div>
        )}
        <NombreOperario usuarioNombre={usuarioNombre} />
        <label className="campo">
          <span>Golpes que marca la máquina ahora</span>
          <input name="golpesInicio" inputMode="numeric" defaultValue={u?.golpesFin ?? p.golpesInicioProduccion ?? ""} className="input text-lg" />
          <span className="campo-ayuda">Ya viene del relevo anterior; cambialo sólo si la máquina marca otro número.</span>
        </label>
        {!turnoAuto && (
          <div className="campo">
            <span>Turno (los horarios no están configurados)</span>
            <ElegirTurno turnos={TURNOS} />
          </div>
        )}
      </FormAccion>
    </section>
  );
}

/** Nombre de la cuenta compartida del taller (usuario «Taller» con PIN). */
const CUENTA_COMPARTIDA = "Taller";

/**
 * Con un usuario propio, lo registrado queda a nombre del operario logueado
 * (no se escribe). Sólo la cuenta compartida «Taller» pide el nombre de quien
 * trabaja el turno, para que no quede todo a nombre de «Taller».
 */
function NombreOperario({ usuarioNombre }: { usuarioNombre: string }) {
  if (usuarioNombre !== CUENTA_COMPARTIDA)
    return (
      <p className="text-sm text-foreground-muted">
        Queda registrado a nombre de <b className="text-foreground">{usuarioNombre}</b>.
      </p>
    );
  return (
    <label className="campo">
      <span>Tu nombre</span>
      <input name="operarioNombre" required placeholder="Quién trabaja en este turno" className="input" />
      <span className="campo-ayuda">Estás con la cuenta compartida del taller: escribí tu nombre para que el registro quede a tu nombre.</span>
    </label>
  );
}

function itemsDe(r: Receta, pie: Mat): ItemCarga[] {
  return r.items.map((i) => ({
    materiaPrimaId: i.materiaPrimaId,
    presentacionId: i.presentacionId,
    nombre: i.materiaPrimaNombre,
    presentacion: i.presentacionNombre,
    kgPres: i.kgPresentacion,
    cantidad: i.cantidad,
    esMaster: i.esMaster,
    enPie: pie.find((m) => m.materiaPrimaId === i.materiaPrimaId)?.kg ?? 0,
  }));
}

/** Registrar carga en tolva de material a pie de máquina (un solo paso). */
function RegistrarCarga({ p, pie }: { p: Prod; pie: Mat }) {
  const receta = p.usarArranque && p.recetaArranque ? p.recetaArranque : p.receta;
  const tipo = p.usarArranque && p.recetaArranque ? "ARRANQUE" : "REGIMEN";
  if (!receta) {
    return (
      <section className="panel">
        <h2 className="panel-titulo">Registrar carga en tolva de material a pie de máquina</h2>
        <p className="aviso aviso-alerta">Este producto no tiene receta de carga. Avisale al Encargado para que la defina.</p>
      </section>
    );
  }
  const cargas = p.falta != null && receta.kgVirgen > 0 && p.kgPorUnidad ? Math.ceil((p.falta * p.kgPorUnidad) / receta.kgVirgen) : null;
  return (
    <section className="panel space-y-3">
      <h2 className="panel-titulo">Registrar carga en tolva de material a pie de máquina</h2>
      <p className="text-sm text-foreground-muted">
        {tipo === "ARRANQUE" ? "Primera carga después del cambio de color (receta reforzada). " : ""}
        Tildá lo que cargaste. {cargas != null ? `Para lo que falta producir son unas ${cargas} cargas como esta.` : ""} Responsable:{" "}
        <b className="text-foreground">{p.turnoAbierto ? (p.turnoAbierto.operarioNombre ?? p.turnoAbierto.usuarioNombre) : "vos"}</b>.
      </p>
      <FormAccion accion={cargarRecetaAction} ocultos={{ cicloId: p.cicloId, tipo }} boton="Registrar carga en tolva" claseBoton="btn btn-primary btn-lg btn-block" className="space-y-3">
        <CargaTolva items={itemsDe(receta, pie)} motivos={MOTIVOS_EXCEPCION_CARGA} productoNumero={p.productoNumero} />
      </FormAccion>
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
    </section>
  );
}

function FormRelevo({ p }: { p: Prod }) {
  return (
    <FormAccion accion={cerrarTurnoAction} ocultos={{ cicloId: p.cicloId }} boton="Cerrar mi turno y dejar relevo" claseBoton="btn btn-azul btn-lg btn-block" className="space-y-3 rounded-xl border border-border p-3">
      <label className="campo">
        <span>Golpes que marca la máquina</span>
        <input name="golpesFin" inputMode="numeric" required className="input text-lg" />
        <span className="campo-ayuda">
          Al empezar tu turno marcaba {p.turnoAbierto?.golpesInicio != null ? fmtNumero(p.turnoAbierto.golpesInicio, 0) : "—"}. Las piezas se calculan solas.
        </span>
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
      <p className="campo-ayuda">El material que queda a pie de máquina y en tolva lo informa el sistema.</p>
    </FormAccion>
  );
}

function FormFinalizar({ p, sobrantes }: { p: Prod; sobrantes: { id: number; nombre: string }[] }) {
  return (
    <FormAccion
      accion={cerrarProduccionTallerAction}
      ocultos={{ cicloId: p.cicloId }}
      boton="Finalizar producción"
      claseBoton="btn btn-primary btn-lg btn-block"
      confirmar="¿Finalizar la producción? Lo producido entra a stock y la tanda queda completada."
      className="space-y-3 rounded-xl border border-border p-3"
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
      <div className="grid grid-cols-2 gap-2">
        <label className="campo">
          <span>Sobrante bajado de tolva (kg)</span>
          <input name="sobranteKg" inputMode="decimal" placeholder="0" className="input" />
        </label>
        <label className="campo">
          <span>Código del sobrante</span>
          <select name="sobranteMpId" defaultValue="" className="input">
            <option value="">—</option>
            {sobrantes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="campo-ayuda">La colada se calcula sola. Entra a stock lo producido menos el descarte.</p>
    </FormAccion>
  );
}
