import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { puedeGestionarMatrices, puedeVerMatrices } from "@/lib/auth/permisos";
import {
  ESTADO_INTERVENCION_LABEL,
  TIPO_INTERVENCION_LABEL,
  listarIntervenciones,
  matricesConocidas,
  responsablesMatrices,
  type FilaIntervencion,
} from "@/lib/data/matrices";
import { FormAccion } from "@/components/form-accion";
import { actualizarIntervencionAction, programarIntervencionAction } from "@/app/actions/matrices";
import { INYECTORAS } from "@/lib/inyectoras";
import { TURNOS, etiquetaTurno } from "@/lib/data/planificacion";
import { fmtFecha, fmtFechaHora, hoyISO } from "@/lib/format";

const BADGE: Record<FilaIntervencion["estado"], string> = { PROGRAMADA: "badge-info", EN_CURSO: "badge-bajo", REALIZADA: "badge-ok", CANCELADA: "bg-surface-muted text-foreground-muted" };

/**
 * Matrices: programación de cambios de matriz, reparaciones y services, con
 * su estado y el historial de trabajos. Lo programado aparece en el
 * calendario de Producción para que el Encargado lo tenga en cuenta.
 */
export default async function MatricesPage({ searchParams }: { searchParams: Promise<{ matriz?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeVerMatrices(usuario.rol)) redirect("/tablero");
  const sp = await searchParams;
  const edita = puedeGestionarMatrices(usuario.rol);
  const [abiertas, historial, matrices, responsables] = await Promise.all([
    listarIntervenciones({ estados: ["PROGRAMADA", "EN_CURSO"] }),
    listarIntervenciones({ estados: ["REALIZADA", "CANCELADA"], matriz: sp.matriz, limite: 60 }),
    matricesConocidas(),
    responsablesMatrices(),
  ]);
  const hoy = hoyISO();

  return (
    <div className="space-y-5">
      <div className="encabezado">
        <div>
          <h1>Matrices</h1>
          <p>Cambios de matriz programados, reparaciones, services e historial de trabajos.</p>
        </div>
        <div className="stat">
          <span className="stat-valor">{abiertas.length}</span>
          <span className="stat-label">trabajos pendientes</span>
        </div>
      </div>

      <p className="aviso aviso-info text-sm">
        Lo programado se ve en Producción → Calendario por turno. En qué turnos se pueden hacer los cambios de matriz todavía no está definido:
        el sistema avisa, no bloquea la producción.
      </p>

      {edita && (
        <details className="panel" open={abiertas.length === 0}>
          <summary className="cursor-pointer font-semibold text-brand-azul">Programar un trabajo</summary>
          <FormAccion accion={programarIntervencionAction} boton="Programar" className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="campo">
              <span>Tipo *</span>
              <select name="tipo" defaultValue="CAMBIO_MATRIZ" className="input">
                {Object.entries(TIPO_INTERVENCION_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Matriz *</span>
              <input name="matriz" required list="matrices-conocidas" className="input" placeholder="Ej.: Rejilla" />
            </label>
            <label className="campo">
              <span>Matriz que sale (en un cambio)</span>
              <input name="matrizAnterior" list="matrices-conocidas" className="input" />
            </label>
            <label className="campo">
              <span>Inyectora</span>
              <select name="inyectora" defaultValue="" className="input">
                <option value="">— (taller / sin máquina)</option>
                {INYECTORAS.map((n) => (
                  <option key={n} value={n}>
                    Inyectora {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Fecha *</span>
              <input name="fechaProgramada" type="date" required defaultValue={hoy} className="input" />
            </label>
            <label className="campo">
              <span>Turno</span>
              <select name="turno" defaultValue="" className="input">
                <option value="">Sin definir</option>
                {TURNOS.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.etiqueta}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Responsable</span>
              <select name="responsableId" defaultValue={responsables.some((r) => r.id === usuario.id) ? usuario.id : ""} className="input">
                <option value="">—</option>
                {responsables.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo sm:col-span-2">
              <span>Qué hay que hacer</span>
              <input name="descripcion" className="input" />
            </label>
            <datalist id="matrices-conocidas">
              {matrices.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </FormAccion>
        </details>
      )}

      <section className="space-y-2">
        <h2 className="panel-titulo">Programados y en curso</h2>
        {abiertas.length === 0 && <p className="text-sm text-foreground-muted">No hay trabajos pendientes.</p>}
        {abiertas.map((i) => (
          <article key={i.id} className={`panel ${i.fechaProgramada < hoy ? "border-[var(--estado-critico-fg)]" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold">
                  {TIPO_INTERVENCION_LABEL[i.tipo]} · {i.matrizAnterior ? `${i.matrizAnterior} → ` : ""}
                  {i.matriz}
                  {i.inyectora ? ` · inyectora ${i.inyectora}` : ""}
                </div>
                <div className="text-sm text-foreground-muted">
                  {fmtFecha(i.fechaProgramada)}
                  {i.turno ? ` · turno ${etiquetaTurno(i.turno)}` : ""} · responsable: {i.responsableNombre ?? "sin asignar"}
                  {i.iniciadaEn ? ` · empezó ${fmtFechaHora(i.iniciadaEn)}` : ""}
                </div>
                {i.descripcion && <p className="mt-1 text-sm">{i.descripcion}</p>}
                {i.fechaProgramada < hoy && <p className="text-xs font-semibold text-[var(--estado-critico-fg)]">Fecha pasada: reprogramalo o cerralo.</p>}
              </div>
              <span className={`badge-estado ${BADGE[i.estado]}`}>{ESTADO_INTERVENCION_LABEL[i.estado]}</span>
            </div>
            {edita && (
              <FormAccion accion={actualizarIntervencionAction} boton="Guardar" ocultos={{ id: i.id }} className="mt-3 grid gap-2 sm:grid-cols-4">
                <label className="campo">
                  <span>Estado</span>
                  <select name="estado" defaultValue={i.estado} className="input">
                    {Object.entries(ESTADO_INTERVENCION_LABEL).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="campo">
                  <span>Fecha</span>
                  <input name="fechaProgramada" type="date" defaultValue={i.fechaProgramada} className="input" />
                </label>
                <label className="campo">
                  <span>Observaciones</span>
                  <input name="observaciones" defaultValue={i.observaciones ?? ""} className="input" />
                </label>
                <label className="campo">
                  <span>Motivo (cancelación o cambio)</span>
                  <input name="motivo" className="input" />
                </label>
              </FormAccion>
            )}
          </article>
        ))}
      </section>

      <section className="panel overflow-x-auto p-0">
        <div className="flex flex-wrap items-end justify-between gap-2 px-5 pt-4">
          <h2 className="panel-titulo mb-0">Historial de trabajos</h2>
          <form className="flex items-end gap-2 pb-2" action="/matrices">
            <label className="campo">
              <span>Matriz</span>
              <select name="matriz" defaultValue={sp.matriz ?? ""} className="input py-1 text-sm">
                <option value="">Todas</option>
                {matrices.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-outline btn-sm">Filtrar</button>
          </form>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Trabajo</th>
              <th>Máquina</th>
              <th>Responsable</th>
              <th>Estado</th>
              <th>Observaciones</th>
            </tr>
          </thead>
          <tbody>
            {historial.map((i) => (
              <tr key={i.id}>
                <td className="whitespace-nowrap">{i.realizadaEn ? fmtFechaHora(i.realizadaEn) : fmtFecha(i.fechaProgramada)}</td>
                <td>
                  {TIPO_INTERVENCION_LABEL[i.tipo]} · {i.matrizAnterior ? `${i.matrizAnterior} → ` : ""}
                  {i.matriz}
                  {i.descripcion && <div className="text-xs text-foreground-muted">{i.descripcion}</div>}
                </td>
                <td>{i.inyectora ? `Iny. ${i.inyectora}` : "—"}</td>
                <td>{i.responsableNombre ?? "—"}</td>
                <td>
                  <span className={`badge-estado ${BADGE[i.estado]}`}>{ESTADO_INTERVENCION_LABEL[i.estado]}</span>
                </td>
                <td className="text-sm">{i.observaciones ?? "—"}</td>
              </tr>
            ))}
            {historial.length === 0 && (
              <tr>
                <td colSpan={6} className="text-foreground-muted">
                  Todavía no hay trabajos cerrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
