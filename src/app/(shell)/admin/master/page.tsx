import { compararRecetasConDosificacion, listarDosificaciones, opcionesDosificacion, type FilaDosificacion } from "@/lib/data/dosificacion";
import { fmtPeso } from "@/lib/presentaciones";
import Link from "next/link";
import { actualizarDosificacionAction, crearDosificacionAction, eliminarDosificacionAction } from "@/app/actions/admin";
import { Aviso, BOTON, BOTON_SECUNDARIO, TD, TH, UltimaModificacion, exigirSeccion } from "../comunes";

const FAMILIA_LABEL = { REJILLA: "Piso Rejilla", CIEGO: "Piso Ciego" } as const;
const VOLVER = "/admin/master";

export default async function AdminMasterPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await exigirSeccion("/admin/master");
  const sp = await searchParams;
  const [filas, { colores, materias }, impacto] = await Promise.all([listarDosificaciones(), opcionesDosificacion(), compararRecetasConDosificacion()]);
  const pendienteProporcion = filas.some((f) => f.materiaPrimaBase2Id && f.proporcionBase1 == null);

  return (
    <div className="space-y-4">
      <Aviso ok={sp.ok} error={sp.error} />
      <div className="aviso aviso-info space-y-1 text-sm">
        <p>
          <b>Definición vigente (minuta del 22/10):</b> piso rejilla, 15 g de master por cada kg de 2240P; piso ciego, 15 g de master por
          cada 0,5 kg de mezcla de 2630PC y Plastomer (= 30 g por kg de mezcla).
        </p>
        <p>
          <b>Cambio respecto de lo anterior:</b> la dosificación estaba cargada como 0,015 / 0,012 / 0,018 «g por kg». El cliente confirmó
          que eran kilos de master por kilo de materia prima, es decir 15 / 12 / 18 g por kg. Se corrigió la unidad; el ciego pasó a 30 g/kg
          por la nueva regla. Las producciones ya cerradas no cambian: el consumo registrado es el que se cargó en tolva.
        </p>
        <p>
          La carga en tolva sigue usando las <Link href="/admin/recetas" className="underline">recetas en bolsas</Link>; abajo se compara cada receta con esta
          dosificación para que el Encargado decida si la ajusta.
        </p>
      </div>
      {pendienteProporcion && (
        <p className="aviso aviso-alerta text-sm">
          Falta definir la proporción entre los dos materiales de la mezcla del piso ciego (2630PC y Plastomer). Sin ese dato se calcula el
          master total, pero no cuántas bolsas de cada material.
        </p>
      )}
      <div className="rounded-lg border border-border bg-surface p-4 text-sm text-foreground-muted">
        <p>
          La fila <strong>«Todos los colores»</strong> es el valor base del tipo de piso; una fila con un color es una excepción para ese color
          (por ejemplo, el negro de rejilla). Se carga como el cliente lo dice: <strong>gramos de master cada X kg</strong> de material base.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                <th className={TH}>Tipo de producto</th>
                <th className={TH}>Color</th>
                <th className={TH}>Material base</th>
                <th className={TH}>Segundo material (mezcla) y proporción</th>
                <th className={TH}>Master</th>
                <th className={TH}>Observaciones</th>
                <th className={TH}>Última modificación</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <FilaMaster key={f.id} f={f} materias={materias} />
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-foreground-muted">
                    Todavía no hay dosificaciones cargadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <section className="panel">
        <h2 className="panel-titulo">Impacto en las recetas de carga activas</h2>
        {impacto.length === 0 ? (
          <p className="text-sm text-foreground-muted">Todavía no hay recetas de carga definidas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Material base por carga</th>
                  <th>Master en la receta</th>
                  <th>Según la dosificación</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {impacto.map((x) => {
                  const dif = x.kgMasterDosificacion == null ? null : Math.round((x.kgMasterDosificacion - x.kgMasterReceta) * 1000) / 1000;
                  return (
                    <tr key={x.productoId}>
                      <td>
                        <div className="font-semibold">{x.codigo}</div>
                        <div className="text-xs text-foreground-muted">{x.descripcion}</div>
                      </td>
                      <td>{fmtPeso(x.kgBase)}</td>
                      <td>
                        {fmtPeso(x.kgMasterReceta, { gramos: true })}
                        {x.gPorKgReceta != null && <div className="text-xs text-foreground-muted">{x.gPorKgReceta} g por kg</div>}
                      </td>
                      <td>
                        {x.kgMasterDosificacion == null ? (
                          <span className="text-foreground-muted">sin dosificación</span>
                        ) : (
                          <>
                            {fmtPeso(x.kgMasterDosificacion, { gramos: true })}
                            {x.sugerenciaMaster && <div className="text-xs text-foreground-muted">= {x.sugerenciaMaster}</div>}
                            {x.proporcionPendiente && <div className="text-xs text-[var(--estado-bajo-fg)]">proporción de la mezcla pendiente</div>}
                          </>
                        )}
                      </td>
                      <td>
                        {dif == null ? null : dif === 0 ? (
                          <span className="badge-estado badge-ok">coincide</span>
                        ) : (
                          <Link href={`/admin/recetas?producto=${x.productoId}#p-${x.productoId}`} className="badge-estado badge-bajo">
                            {dif > 0 ? "+" : "−"}
                            {fmtPeso(Math.abs(dif), { gramos: true })} · revisar
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="rounded-lg border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Agregar valor base o excepción por color</summary>
        <form action={crearDosificacionAction} className="mt-3 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="volver" value={VOLVER} />
          <Campo label="Tipo de producto">
            <select name="familia" className="input" required>
              <option value="REJILLA">Piso Rejilla</option>
              <option value="CIEGO">Piso Ciego</option>
            </select>
          </Campo>
          <Campo label="Color">
            <select name="colorId" className="input">
              <option value="">Todos los colores (valor base)</option>
              {colores.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Materia prima base">
            <SelectMateria materias={materias} />
          </Campo>
          <Campo label="Gramos de master">
            <input name="gMaster" type="number" step="any" min="0" required placeholder="ej. 15" className="input" />
          </Campo>
          <Campo label="…cada (kg de material base)">
            <input name="kgReferencia" type="number" step="any" min="0" defaultValue={1} required className="input" />
          </Campo>
          <Campo label="Observaciones">
            <input name="observaciones" className="input" />
          </Campo>
          <Campo label="Motivo del cambio">
            <input name="motivo" className="input" placeholder="opcional" />
          </Campo>
          <div>
            <button type="submit" className={BOTON}>
              Agregar
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

function FilaMaster({ f, materias }: { f: FilaDosificacion; materias: { id: number; nombre: string }[] }) {
  const formId = `dm-${f.id}`;
  return (
    <tr id={`fila-${f.id}`} className="border-b border-border last:border-0">
      <td className={`${TD} font-medium`}>{FAMILIA_LABEL[f.familia]}</td>
      <td className={TD}>
        {f.colorNombre ?? <span className="text-foreground-muted">Todos los colores</span>}
        {f.colorId != null && <div className="text-xs text-foreground-muted">excepción</div>}
      </td>
      <td className={TD}>
        <SelectMateria materias={materias} form={formId} valor={f.materiaPrimaBaseId} />
      </td>
      <td className={TD}>
        <SelectMateria materias={materias} form={formId} valor={f.materiaPrimaBase2Id} nombre="materiaPrimaBase2Id" />
        {f.materiaPrimaBase2Id != null && (
          <label className="mt-1 flex items-center gap-1 text-xs">
            <input form={formId} name="proporcionPct" type="number" step="any" min="1" max="99" defaultValue={f.proporcionBase1 == null ? "" : Math.round(f.proporcionBase1 * 1000) / 10} placeholder="pendiente" className="input w-24 py-1" />
            % del material base
            {f.proporcionBase1 == null && <span className="badge-estado badge-bajo">pendiente</span>}
          </label>
        )}
      </td>
      <td className={TD}>
        <div className="flex items-center gap-1 whitespace-nowrap">
          <input form={formId} name="gMaster" type="number" step="any" min="0" required defaultValue={f.gPorReferencia} className="input w-20" aria-label="Gramos de master" />
          g cada
          <input form={formId} name="kgReferencia" type="number" step="any" min="0" required defaultValue={f.kgReferencia} className="input w-20" aria-label="kg de base" />
          kg
        </div>
        <div className="text-xs text-foreground-muted">= {Math.round(f.gPorKgMp * 100) / 100} g por kg</div>
      </td>
      <td className={TD}>
        <input form={formId} name="observaciones" defaultValue={f.observaciones ?? ""} className="input min-w-[14rem]" />
      </td>
      <td className={TD}>
        <UltimaModificacion valor={{ fecha: f.actualizadoEn, usuarioNombre: f.actualizadoPorNombre ?? "—" }} />
      </td>
      <td className={TD}>
        <div className="flex flex-col items-start gap-2">
          <form id={formId} action={actualizarDosificacionAction}>
            <input type="hidden" name="id" value={f.id} />
            <input type="hidden" name="volver" value={VOLVER} />
            <input type="hidden" name="ancla" value={`fila-${f.id}`} />
            <button type="submit" className={BOTON}>
              Guardar
            </button>
          </form>
          {f.colorId != null && (
            <form action={eliminarDosificacionAction}>
              <input type="hidden" name="id" value={f.id} />
              <input type="hidden" name="volver" value={VOLVER} />
              <button type="submit" className={`${BOTON_SECUNDARIO} text-[var(--estado-critico-fg)]`}>
                Quitar excepción
              </button>
            </form>
          )}
        </div>
      </td>
    </tr>
  );
}

function SelectMateria({ materias, form, valor, nombre = "materiaPrimaBaseId" }: { materias: { id: number; nombre: string }[]; form?: string; valor?: number | null; nombre?: string }) {
  return (
    <select name={nombre} form={form} defaultValue={valor ?? ""} className="input min-w-[14rem]">
      <option value="">—</option>
      {materias.map((m) => (
        <option key={m.id} value={m.id}>
          {m.nombre}
        </option>
      ))}
    </select>
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
