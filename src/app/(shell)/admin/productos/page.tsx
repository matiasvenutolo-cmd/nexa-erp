import { listarProductos } from "@/lib/data/catalogo";
import { guardarDatosTecnicosAction } from "@/app/actions/admin";
import { Aviso, BOTON, TD, TH, exigirSeccion } from "../comunes";

const VOLVER = "/admin/productos";

/**
 * Datos técnicos por producto: superficie por pieza (sólo pisos) y peso por
 * pieza. Los usan el resumen de m² del pedido, el material necesario del
 * retiro y las piezas teóricas del control de material.
 */
export default async function AdminProductosPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  await exigirSeccion(VOLVER);
  const sp = await searchParams;
  const productos = await listarProductos();
  const faltan = productos.filter((p) => (!p.esAccesorio && p.m2PorUnidad == null) || p.kgPorUnidad == null);

  return (
    <div className="space-y-4">
      <Aviso ok={sp.ok} error={sp.error} />
      <div className="rounded-lg border border-border bg-surface p-4 text-sm text-foreground-muted">
        <p>
          <strong>m² por pieza</strong> (sólo pisos; los accesorios no suman superficie), <strong>kg por pieza</strong> y <strong>colada por golpe</strong>
          (el recorrido hasta la pieza pesa siempre lo mismo: con este dato la colada se calcula sola al cerrar la producción) y si el producto
          admite <strong>sobrante</strong> (habilitado en todos desde la minuta del 22/10) o <strong>molienda</strong> (material reciclado, aparte) en su
          receta. El <strong>peso por pieza</strong> viene de la planilla general (0,61 kg para todos los pisos) y el cliente lo está confirmando por
          tipo: mientras diga «a confirmar», los cálculos de material se muestran como estimados. Un valor vacío significa “sin configurar”: el
          sistema lo informa en vez de estimarlo.
        </p>
        <p className="mt-1">{faltan.length ? `${faltan.length} productos con datos sin configurar.` : "Todos los productos tienen sus datos configurados."}</p>
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                <th className={TH}>Producto</th>
                <th className={TH}>m² por pieza</th>
                <th className={TH}>kg por pieza</th>
                <th className={TH}>Colada por golpe (kg)</th>
                <th className={TH}>Peso confirmado</th>
                <th className={TH}>Sobrante / molienda en receta</th>
                <th className={TH}>Motivo</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {productos.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className={TD}>
                    <div className="font-mono text-xs text-foreground-muted">{p.codigo}</div>
                    <div className="text-xs">{p.descripcion}</div>
                  </td>
                  <td className={TD} colSpan={7}>
                    <form action={guardarDatosTecnicosAction} className="grid grid-cols-[7rem_7rem_7rem_6rem_8rem_1fr_auto] items-center gap-2">
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="volver" value={VOLVER} />
                      <input type="hidden" name="ancla" value={`p${p.id}`} />
                      {p.esAccesorio ? (
                        <span className="text-xs text-foreground-muted">no aplica</span>
                      ) : (
                        <input name="m2PorUnidad" type="number" step="any" min="0" defaultValue={p.m2PorUnidad ?? ""} placeholder="sin configurar" className="input text-xs" aria-label="m² por pieza" />
                      )}
                      <input name="kgPorUnidad" type="number" step="any" min="0" defaultValue={p.kgPorUnidad ?? ""} placeholder="sin configurar" className="input text-xs" aria-label="kg por pieza" />
                      <input name="coladaKgPorGolpe" type="number" step="any" min="0" defaultValue={p.coladaKgPorGolpe ?? ""} placeholder="sin configurar" className="input text-xs" aria-label="colada por golpe" />
                      <select name="pesoConfirmado" defaultValue={p.pesoConfirmado ? "1" : "0"} className="input text-xs" aria-label="Peso confirmado por el cliente">
                        <option value="0">A confirmar</option>
                        <option value="1">Confirmado</option>
                      </select>
                      <div className="flex flex-col gap-1 text-xs">
                        <label className="flex items-center gap-1">
                          <input type="checkbox" name="aceptaSobrante" value="1" defaultChecked={p.aceptaSobrante} /> sobrante
                        </label>
                        <label className="flex items-center gap-1">
                          <input type="checkbox" name="aceptaMolienda" value="1" defaultChecked={p.aceptaMolienda} /> molienda
                        </label>
                      </div>
                      <input name="motivo" placeholder="opcional" className="input text-xs" aria-label="Motivo" />
                      <button type="submit" className={BOTON} id={`p${p.id}`}>
                        Guardar
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
