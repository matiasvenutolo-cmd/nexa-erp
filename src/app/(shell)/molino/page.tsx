import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { puedeOperarMolino, puedeRecibirMolienda, puedeVerMolino } from "@/lib/auth/permisos";
import { ESTADO_MOLIENDA_LABEL, codigosMolienda, descartesPendientes, listarMoliendas, produccionesRecientes } from "@/lib/data/molino";
import { FormAccion } from "@/components/form-accion";
import { confirmarMoliendaAction, entregarMoliendaAction, recibirDescarteAction } from "@/app/actions/molino";
import { fmtFechaHora } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";

/**
 * Molino: recepción de descartes, molienda pesada por bolsón/canasto y
 * entrega a Materia Prima, que confirma la recepción (recién ahí es stock).
 * La molienda (reciclado) no se mezcla con el sobrante (material sin moler).
 */
export default async function MolinoPage() {
  const usuario = await getUsuarioActual();
  if (!puedeVerMolino(usuario.rol)) redirect("/tablero");
  const opera = puedeOperarMolino(usuario.rol);
  const recibe = puedeRecibirMolienda(usuario.rol);
  const [pendientes, porConfirmar, historial, codigos, producciones] = await Promise.all([
    descartesPendientes(),
    listarMoliendas({ estado: "ENTREGADA" }),
    listarMoliendas({ limite: 40 }),
    codigosMolienda(),
    produccionesRecientes(),
  ]);
  const kgPendiente = pendientes.reduce((t, d) => t + Number(d.d.kg), 0);

  return (
    <div className="space-y-5">
      <div className="encabezado">
        <div>
          <h1>Molino</h1>
          <p>Descartes recibidos, molienda pesada y entregada a Materia Prima.</p>
        </div>
        <div className="flex gap-6">
          <div className="stat">
            <span className="stat-valor">{fmtPeso(kgPendiente)}</span>
            <span className="stat-label">descarte por moler</span>
          </div>
          <div className="stat">
            <span className={`stat-valor ${porConfirmar.length ? "text-[var(--estado-bajo-fg)]" : ""}`}>{porConfirmar.length}</span>
            <span className="stat-label">entregas sin confirmar</span>
          </div>
        </div>
      </div>

      <p className="aviso aviso-info text-sm">
        La <b>molienda</b> es material reciclado de coladas o descartes y se maneja aparte del <b>sobrante</b> (material sin moler que vuelve de
        la tolva o de una bolsa abierta). El descarte no es stock: la molienda entra al stock general cuando Materia Prima confirma la recepción.
      </p>

      {recibe && porConfirmar.length > 0 && (
        <section className="panel space-y-3">
          <h2 className="panel-titulo">Confirmar recepción en Materia Prima</h2>
          {porConfirmar.map((m) => (
            <div key={m.e.id} className="rounded-lg border border-border p-3">
              <div className="font-semibold">
                Bolsón {m.e.bolson} · {m.mpNombre} · {fmtPeso(Number(m.e.kg))}
              </div>
              <div className="text-xs text-foreground-muted">
                Entregó {m.entregaNombre} · {fmtFechaHora(m.e.entregadoEn)}
                {m.e.observaciones ? ` · ${m.e.observaciones}` : ""}
              </div>
              <div className="mt-2 flex flex-wrap gap-3">
                <FormAccion accion={confirmarMoliendaAction} boton="Confirmar recepción" ocultos={{ id: m.e.id, aceptar: "1" }} className="flex flex-wrap items-end gap-2">
                  <label className="campo w-40">
                    <span>Peso en MP (si difiere)</span>
                    <input name="kgRecibidos" inputMode="decimal" placeholder={String(m.e.kg).replace(".", ",")} className="input" />
                  </label>
                </FormAccion>
                <FormAccion accion={confirmarMoliendaAction} boton="Rechazar" claseBoton="btn btn-outline" ocultos={{ id: m.e.id, aceptar: "0" }} className="flex flex-wrap items-end gap-2">
                  <label className="campo w-56">
                    <span>Motivo del rechazo</span>
                    <input name="motivo" className="input" />
                  </label>
                </FormAccion>
              </div>
            </div>
          ))}
        </section>
      )}

      {opera && (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="panel">
            <h2 className="panel-titulo">Recibir descarte</h2>
            <FormAccion accion={recibirDescarteAction} boton="Registrar descarte" className="grid gap-2 sm:grid-cols-2">
              <label className="campo">
                <span>Origen *</span>
                <input name="origen" required placeholder="Ej.: inyectora 8, colada" className="input" />
              </label>
              <label className="campo">
                <span>Producción (opcional)</span>
                <select name="cicloId" defaultValue="" className="input">
                  <option value="">—</option>
                  {producciones.map((p) => (
                    <option key={p.id} value={p.id}>
                      #{p.id} · iny. {p.inyectora}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo">
                <span>Material / composición *</span>
                <input name="material" required placeholder="Ej.: rejilla negro (2240P + master negro)" className="input" />
              </label>
              <label className="campo">
                <span>Peso (kg) *</span>
                <input name="kg" required inputMode="decimal" className="input" />
              </label>
              <label className="campo sm:col-span-2">
                <span>Observaciones</span>
                <input name="observaciones" className="input" />
              </label>
            </FormAccion>
          </section>

          <section className="panel">
            <h2 className="panel-titulo">Entregar molienda a Materia Prima</h2>
            <FormAccion accion={entregarMoliendaAction} boton="Entregar a MP" className="grid gap-2 sm:grid-cols-2">
              <label className="campo">
                <span>Código de molienda *</span>
                <select name="materiaPrimaId" required defaultValue="" className="input">
                  <option value="" disabled>
                    Elegí…
                  </option>
                  {codigos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="campo">
                <span>Bolsón / canasto *</span>
                <input name="bolson" required placeholder="Ej.: n4" className="input" />
              </label>
              <label className="campo">
                <span>Peso pesado (kg) *</span>
                <input name="kg" required inputMode="decimal" className="input" />
              </label>
              <label className="campo">
                <span>Observaciones</span>
                <input name="observaciones" className="input" />
              </label>
              {pendientes.length > 0 && (
                <fieldset className="sm:col-span-2">
                  <legend className="mb-1 text-sm text-foreground-muted">Descartes que se molieron en este bolsón</legend>
                  <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                    {pendientes.map((d) => (
                      <li key={d.d.id}>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" name="descarteId" value={d.d.id} />
                          {fmtPeso(Number(d.d.kg))} · {d.d.material} · {d.d.origen}
                        </label>
                      </li>
                    ))}
                  </ul>
                </fieldset>
              )}
            </FormAccion>
          </section>
        </div>
      )}

      <section className="panel overflow-x-auto p-0">
        <h2 className="panel-titulo px-5 pt-4">Descarte pendiente de moler</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Origen</th>
              <th>Material</th>
              <th className="text-right">Peso</th>
              <th>Recibió</th>
            </tr>
          </thead>
          <tbody>
            {pendientes.map((d) => (
              <tr key={d.d.id}>
                <td className="whitespace-nowrap">{fmtFechaHora(d.d.fecha)}</td>
                <td>{d.d.origen}</td>
                <td>{d.d.material}</td>
                <td className="text-right">{fmtPeso(Number(d.d.kg))}</td>
                <td>{d.nombre}</td>
              </tr>
            ))}
            {pendientes.length === 0 && (
              <tr>
                <td colSpan={5} className="text-foreground-muted">
                  No hay descarte pendiente.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel overflow-x-auto p-0">
        <h2 className="panel-titulo px-5 pt-4">Moliendas entregadas</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Entrega</th>
              <th>Bolsón</th>
              <th>Código</th>
              <th className="text-right">Peso</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((m) => (
              <tr key={m.e.id}>
                <td className="whitespace-nowrap">
                  {fmtFechaHora(m.e.entregadoEn)}
                  <div className="text-xs text-foreground-muted">{m.entregaNombre}</div>
                </td>
                <td>{m.e.bolson}</td>
                <td>{m.mpNombre}</td>
                <td className="text-right">{fmtPeso(Number(m.e.kg))}</td>
                <td>
                  <span className={`badge-estado ${m.e.estado === "RECIBIDA" ? "badge-ok" : m.e.estado === "RECHAZADA" ? "badge-critico" : "badge-bajo"}`}>{ESTADO_MOLIENDA_LABEL[m.e.estado]}</span>
                  {m.recibeNombre && <div className="text-xs text-foreground-muted">{m.recibeNombre}</div>}
                </td>
              </tr>
            ))}
            {historial.length === 0 && (
              <tr>
                <td colSpan={5} className="text-foreground-muted">
                  Todavía no hay moliendas entregadas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
