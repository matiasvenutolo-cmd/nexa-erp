import Link from "next/link";
import { FormAccion } from "@/components/form-accion";
import { asignarOperarioAction, guardarEsquemaAction, quitarAsignacionAction } from "@/app/actions/turnos";
import { asignacionesEntre, esquemasEntre, operariosActivos } from "@/lib/data/turnos";
import { ESQUEMA_LABEL, VENTANAS, horarioDe, type Esquema } from "@/lib/turnos";
import { TURNOS, etiquetaTurno } from "@/lib/data/planificacion";
import { hoyISO, lunesDe, sumarDias } from "@/lib/format";

const fmtDia = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });

/**
 * Turnos y operarios (mejoras 22/10): el Encargado elige el esquema de cada
 * día (o de la semana) y asigna los operarios al principio del día. Con el
 * esquema cargado, el operario no elige el turno salvo cuando hay dos activos
 * a la vez (de 12 a 16 en el doble, de 13 a 16 en el triple).
 */
export async function TurnosSemana({ desde, edita }: { desde?: string; edita: boolean }) {
  const inicio = lunesDe(desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : hoyISO());
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(inicio, i));
  const [esquemas, asignaciones, operarios] = await Promise.all([esquemasEntre(dias[0], dias[6]), asignacionesEntre(dias[0], dias[6]), operariosActivos()]);
  const hoy = hoyISO();

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-foreground-muted">
          Esquemas: {(Object.keys(ESQUEMA_LABEL) as Esquema[]).map((e) => ESQUEMA_LABEL[e]).join(" · ")}. El turno noche termina a las 7 del día siguiente.
        </p>
        <div className="flex gap-1">
          <Link href={`/produccion?vista=turnos&desde=${sumarDias(inicio, -7)}`} className="btn btn-outline btn-sm">
            ← Semana anterior
          </Link>
          <Link href="/produccion?vista=turnos" className="btn btn-outline btn-sm">
            Esta semana
          </Link>
          <Link href={`/produccion?vista=turnos&desde=${sumarDias(inicio, 7)}`} className="btn btn-outline btn-sm">
            Semana siguiente →
          </Link>
        </div>
      </div>

      {edita && (
        <div className="panel">
          <h2 className="panel-titulo">Esquema para toda la semana</h2>
          <FormAccion accion={guardarEsquemaAction} boton="Aplicar a los 7 días" claseBoton="btn btn-azul" ocultos={{}}>
            {dias.map((d) => (
              <input key={d} type="hidden" name="fecha" value={d} />
            ))}
            <SelectEsquema />
          </FormAccion>
        </div>
      )}

      {operarios.length === 0 && <p className="aviso aviso-alerta text-sm">No hay operarios activos con PIN para asignar. Se dan de alta en Administración → Usuarios.</p>}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {dias.map((d) => {
          const esq = esquemas.get(d) ?? null;
          const delDia = asignaciones.filter((a) => a.fecha === d);
          return (
            <div key={d} className={`panel space-y-3 ${d === hoy ? "ring-2 ring-[var(--brand-naranja,#ee7d30)]" : ""}`}>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-semibold capitalize">{fmtDia(d)}</h3>
                <span className={`badge-estado ${esq ? "badge-info" : "badge-bajo"}`}>{esq ? esq.toLowerCase() : "sin esquema"}</span>
              </div>
              {edita && (
                <FormAccion accion={guardarEsquemaAction} boton="Guardar" claseBoton="btn btn-outline btn-sm" ocultos={{ fecha: d }}>
                  <SelectEsquema valor={esq} chico />
                </FormAccion>
              )}
              {esq ? (
                <ul className="space-y-2 text-sm">
                  {VENTANAS[esq].map((v) => {
                    const lista = delDia.filter((a) => a.turno === v.turno);
                    return (
                      <li key={v.turno} className="rounded-lg bg-surface-muted p-2">
                        <div className="font-semibold">
                          {etiquetaTurno(v.turno)} <span className="font-normal text-foreground-muted">({horarioDe(esq, v.turno)})</span>
                        </div>
                        {lista.length === 0 ? (
                          <div className="text-xs text-foreground-muted">Sin operarios asignados.</div>
                        ) : (
                          <ul className="mt-1 space-y-1">
                            {lista.map((a) => (
                              <li key={a.id} className="flex items-center justify-between gap-2">
                                <span>
                                  {a.usuarioNombre}
                                  {a.inyectora ? <span className="text-foreground-muted"> · iny. {a.inyectora}</span> : null}
                                </span>
                                {edita && (
                                  <FormAccion accion={quitarAsignacionAction} boton="Quitar" claseBoton="text-xs font-semibold text-[var(--estado-critico-fg)]" ocultos={{ id: a.id }} className="" />
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-foreground-muted">Sin esquema cargado: el operario elige el turno a mano.</p>
              )}
              {edita && esq && operarios.length > 0 && (
                <FormAccion accion={asignarOperarioAction} boton="Asignar" claseBoton="btn btn-primary btn-sm" ocultos={{ fecha: d }} className="grid grid-cols-2 gap-2 border-t border-border pt-2">
                  <select name="usuarioId" required defaultValue="" className="input py-1 text-sm" aria-label="Operario">
                    <option value="" disabled>
                      Operario…
                    </option>
                    {operarios.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nombre}
                      </option>
                    ))}
                  </select>
                  <select name="turno" required defaultValue={VENTANAS[esq][0].turno} className="input py-1 text-sm" aria-label="Turno">
                    {TURNOS.filter((t) => VENTANAS[esq].some((v) => v.turno === t.valor)).map((t) => (
                      <option key={t.valor} value={t.valor}>
                        {t.etiqueta}
                      </option>
                    ))}
                  </select>
                  <input name="inyectora" inputMode="numeric" placeholder="Inyectora (opcional)" className="input py-1 text-sm" aria-label="Inyectora" />
                </FormAccion>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SelectEsquema({ valor, chico }: { valor?: Esquema | null; chico?: boolean }) {
  return (
    <select name="esquema" defaultValue={valor ?? ""} className={`input ${chico ? "py-1 text-sm" : ""}`} aria-label="Esquema de turnos">
      <option value="">Sin esquema</option>
      {(Object.keys(ESQUEMA_LABEL) as Esquema[]).map((e) => (
        <option key={e} value={e}>
          {ESQUEMA_LABEL[e]}
        </option>
      ))}
    </select>
  );
}
