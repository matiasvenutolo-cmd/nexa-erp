import { listarParametros } from "@/lib/data/parametros";
import { guardarParametroAction } from "@/app/actions/admin";
import { Aviso, BOTON, UltimaModificacion, exigirSeccion } from "../comunes";

export default async function AdminParametrosPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await exigirSeccion("/admin/parametros");
  const sp = await searchParams;
  const parametros = await listarParametros();

  return (
    <div className="space-y-4">
      <Aviso ok={sp.ok} error={sp.error} />
      <p className="text-sm text-foreground-muted">
        Valores generales que antes estaban fijos en el programa. Los mínimos y máximos de cada producto están en
        la sección Stock; la dosificación de master, en Master.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {parametros.map((p) => (
          <form key={p.clave} action={guardarParametroAction} className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <input type="hidden" name="clave" value={p.clave} />
            <input type="hidden" name="volver" value="/admin/parametros" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">{p.etiqueta}</h2>
              <p className="mt-1 text-sm text-foreground-muted">{p.descripcion}</p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-sm">
                <span className="mb-1 block text-foreground-muted">Valor{p.unidad ? ` (${p.unidad})` : ""}</span>
                <input name="valor" type="number" step="any" min="0" required defaultValue={Number(p.valor)} className="input w-32" />
              </label>
              <label className="block flex-1 text-sm">
                <span className="mb-1 block text-foreground-muted">Motivo del cambio</span>
                <input name="motivo" className="input" placeholder="opcional" />
              </label>
              <button type="submit" className={BOTON}>
                Guardar
              </button>
            </div>
            <div className="text-xs text-foreground-muted">
              Última modificación: <UltimaModificacion valor={p.ultimaModificacion} />
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}
