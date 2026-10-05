import { listarDosificaciones, opcionesDosificacion, type FilaDosificacion } from "@/lib/data/dosificacion";
import { actualizarDosificacionAction, crearDosificacionAction, eliminarDosificacionAction } from "@/app/actions/admin";
import { Aviso, BOTON, BOTON_SECUNDARIO, TD, TH, UltimaModificacion, exigirSeccion } from "../comunes";

const FAMILIA_LABEL = { REJILLA: "Piso Rejilla", CIEGO: "Piso Ciego" } as const;
const VOLVER = "/admin/master";

export default async function AdminMasterPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await exigirSeccion("/admin/master");
  const sp = await searchParams;
  const [filas, { colores, materias }] = await Promise.all([listarDosificaciones(), opcionesDosificacion()]);

  return (
    <div className="space-y-4">
      <Aviso ok={sp.ok} error={sp.error} />
      <div className="rounded-lg border border-border bg-surface p-4 text-sm text-foreground-muted">
        <p>
          Cantidad de master por cada kg de materia prima. La fila <strong>“Todos los colores”</strong> es el valor
          base del tipo de producto; una fila con un color es una excepción para ese color (por ejemplo, el negro de
          rejilla lleva menos por ser muy intenso). Si un color no tiene excepción, usa el valor base.
        </p>
        <p className="mt-2">
          Unidad: <strong>gramos de master por kg de materia prima</strong> (g/kg).
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                <th className={TH}>Tipo de producto</th>
                <th className={TH}>Color</th>
                <th className={TH}>Materia prima base</th>
                <th className={TH}>Master (g/kg de MP)</th>
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
                  <td colSpan={7} className="px-4 py-8 text-center text-foreground-muted">
                    Todavía no hay dosificaciones cargadas.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
          <Campo label="Master (g por kg de MP)">
            <input name="gPorKgMp" type="number" step="any" min="0" required placeholder="ej. 0.015" className="input" />
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
        <input form={formId} name="gPorKgMp" type="number" step="any" min="0" required defaultValue={f.gPorKgMp} className="input min-w-[7.5rem]" />
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

function SelectMateria({ materias, form, valor }: { materias: { id: number; nombre: string }[]; form?: string; valor?: number | null }) {
  return (
    <select name="materiaPrimaBaseId" form={form} defaultValue={valor ?? ""} className="input min-w-[14rem]">
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
