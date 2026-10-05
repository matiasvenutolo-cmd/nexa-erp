import Link from "next/link";
import { listarMinMaxMateriaPrima, listarMinMaxProductos, type FilaMinMax } from "@/lib/data/stock-config";
import { guardarMinMaxMateriaPrimaAction, guardarMinMaxProductoAction } from "@/app/actions/admin";
import { Semaforo } from "@/components/semaforo";
import { fmtNumero } from "@/lib/format";
import { Aviso, BOTON, TD, TH, UltimaModificacion, exigirSeccion } from "../comunes";

export default async function AdminStockPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; texto?: string; ok?: string; error?: string }>;
}) {
  await exigirSeccion("/admin/stock");
  const sp = await searchParams;
  const vista = sp.vista === "mp" ? "mp" : "productos";
  const filas = vista === "mp" ? await listarMinMaxMateriaPrima() : await listarMinMaxProductos();
  const texto = sp.texto?.trim().toLowerCase();
  const visibles = texto
    ? filas.filter((f) => f.codigo.toLowerCase().includes(texto) || f.descripcion.toLowerCase().includes(texto))
    : filas;
  const volver = `/admin/stock?vista=${vista}${sp.texto ? `&texto=${encodeURIComponent(sp.texto)}` : ""}`;
  const accion = vista === "mp" ? guardarMinMaxMateriaPrimaAction : guardarMinMaxProductoAction;

  return (
    <div className="space-y-4">
      <Aviso ok={sp.ok} error={sp.error} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {[
            { v: "productos", label: "Productos terminados" },
            { v: "mp", label: "Materia prima" },
          ].map((t) => (
            <Link
              key={t.v}
              href={`/admin/stock?vista=${t.v}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                vista === t.v ? "bg-accent text-accent-foreground" : "bg-surface-muted text-foreground-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
        <form action="/admin/stock" className="flex gap-2">
          <input type="hidden" name="vista" value={vista} />
          <input name="texto" defaultValue={sp.texto ?? ""} placeholder="Buscar por código o nombre" className="input w-56" />
        </form>
      </div>

      <p className="text-sm text-foreground-muted">
        El semáforo se calcula solo con estos valores. Dejá el máximo vacío si no se controla.
        {vista === "mp" ? " Materia prima en kg." : " Productos en unidades."}
      </p>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                <th className={TH}>Código</th>
                <th className={TH}>{vista === "mp" ? "Materia prima" : "Producto"}</th>
                <th className={`${TH} text-right`}>Stock</th>
                <th className={TH}>Mínimo</th>
                <th className={TH}>Máximo</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Última modificación</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <Fila key={f.id} f={f} volver={volver} accion={accion} decimales={vista === "mp"} />
              ))}
              {visibles.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-foreground-muted">
                    No hay resultados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Fila({
  f,
  volver,
  accion,
  decimales,
}: {
  f: FilaMinMax;
  volver: string;
  accion: (fd: FormData) => Promise<void>;
  decimales: boolean;
}) {
  const formId = `mm-${f.id}`;
  const ancla = `fila-${f.id}`;
  const step = decimales ? "any" : "1";
  return (
    <tr id={ancla} className="border-b border-border last:border-0">
      <td className={`${TD} font-mono text-xs text-foreground-muted`}>{f.codigo}</td>
      <td className={`${TD} font-medium text-foreground`}>{f.descripcion}</td>
      <td className={`${TD} text-right`}>{fmtNumero(f.stock, decimales ? 2 : 0)}</td>
      <td className={TD}>
        <input form={formId} name="minimo" type="number" min={0} step={step} defaultValue={f.minimo ?? ""} className="input min-w-[7rem]" />
      </td>
      <td className={TD}>
        <input form={formId} name="maximo" type="number" min={0} step={step} defaultValue={f.maximo ?? ""} className="input min-w-[7rem]" />
      </td>
      <td className={TD}>
        <Semaforo estado={f.estado} />
      </td>
      <td className={TD}>
        <UltimaModificacion valor={f.ultimaModificacion} />
      </td>
      <td className={TD}>
        <form id={formId} action={accion}>
          <input type="hidden" name="id" value={f.id} />
          <input type="hidden" name="volver" value={volver} />
          <input type="hidden" name="ancla" value={ancla} />
          <button type="submit" className={BOTON}>
            Guardar
          </button>
        </form>
      </td>
    </tr>
  );
}
