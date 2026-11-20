import Link from "next/link";
import { redirect } from "next/navigation";
import { Printer } from "lucide-react";
import { getUsuarioActual } from "@/lib/session";
import { puedeCancelarProduccion } from "@/lib/auth/permisos";
import { cajasDeCiclo, produccionesConCajas } from "@/lib/data/produccion";
import { FormAccion } from "@/components/form-accion";
import { reimprimirEtiquetasAction } from "@/app/actions/taller";
import { fmtFecha, fmtNumero, hoyISO, sumarDias } from "@/lib/format";
import { etiquetaInyectora } from "@/lib/inyectoras";

/**
 * Etiquetas (reunión 20/11/2026): las etiquetas salen solas al terminar cada
 * producción, en la pantalla del operario. Acá se encuentran las de cualquier
 * producción para volver a imprimirlas: todas juntas, o algunas cajas con el
 * motivo de la reimpresión (queda en el historial).
 */
export default async function EtiquetasMenuPage({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; texto?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeCancelarProduccion(usuario.rol)) redirect("/tablero");
  const sp = await searchParams;
  const fecha = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const hasta = fecha(sp.hasta) ?? hoyISO();
  const desde = fecha(sp.desde) ?? sumarDias(hasta, -14);
  const producciones = await produccionesConCajas({ desde, hasta, texto: sp.texto });
  const cajas = new Map(await Promise.all(producciones.map(async (p) => [p.cicloId, await cajasDeCiclo(p.cicloId)] as const)));

  return (
    <div className="space-y-5">
      <div className="encabezado">
        <div>
          <h1>Etiquetas</h1>
          <p>Las etiquetas salen al terminar cada producción. Acá se vuelven a imprimir: las de toda una producción o algunas cajas.</p>
        </div>
      </div>

      <form action="/etiquetas" className="panel flex flex-wrap items-end gap-2">
        <label className="campo">
          <span>Desde</span>
          <input type="date" name="desde" defaultValue={desde} className="input" />
        </label>
        <label className="campo">
          <span>Hasta</span>
          <input type="date" name="hasta" defaultValue={hasta} className="input" />
        </label>
        <label className="campo min-w-56 flex-1">
          <span>Producto o color</span>
          <input type="search" name="texto" defaultValue={sp.texto ?? ""} placeholder="Ej.: rejilla rojo, 008B" className="input" />
        </label>
        <button className="btn btn-azul">Buscar</button>
      </form>

      {producciones.length === 0 ? (
        <p className="panel text-sm text-foreground-muted">No hay cajas en esas fechas.</p>
      ) : (
        <div className="panel overflow-x-auto p-0">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Producto</th>
                <th>Partida</th>
                <th className="text-right">Cajas</th>
                <th className="text-right">Piezas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {producciones.map((p) => (
                <tr key={p.cicloId} className="align-top">
                  <td className="whitespace-nowrap">
                    {fmtFecha(p.ultima)}
                    <div className="text-xs text-foreground-muted">{p.fechaFin ? etiquetaInyectora(p.inyectora) : <span className="badge-estado badge-ok">en producción</span>}</div>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      {p.colorHex && <span className="h-4 w-4 shrink-0 rounded-sm border border-[rgba(29,43,58,0.2)]" style={{ background: p.colorHex }} />}
                      <b>{p.productoCodigo.split("-")[0]}</b> {p.colorNombre}
                    </div>
                    <div className="text-xs text-foreground-muted">{p.productoDescripcion}</div>
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer font-semibold text-accent">Reimprimir algunas cajas</summary>
                      <FormAccion accion={reimprimirEtiquetasAction} boton="Reimprimir las tildadas" claseBoton="btn btn-outline btn-sm" className="mt-2 space-y-2">
                        <ul className="flex flex-wrap gap-2">
                          {(cajas.get(p.cicloId) ?? []).map((c) => (
                            <li key={c.id}>
                              <label className="flex items-center gap-1.5 rounded bg-surface-muted px-2 py-1 font-mono text-xs">
                                <input type="checkbox" name="caja" value={c.id} />
                                {c.codigo} · {c.cantidad} u.
                              </label>
                            </li>
                          ))}
                        </ul>
                        <input name="motivo" required placeholder="Motivo (ej. se rompió la etiqueta)" className="input max-w-sm" />
                      </FormAccion>
                    </details>
                  </td>
                  <td className="whitespace-nowrap">{p.partida ?? "—"}</td>
                  <td className="text-right tabular-nums">{p.cajas}</td>
                  <td className="text-right tabular-nums">{fmtNumero(p.piezas, 0)}</td>
                  <td className="text-right">
                    <Link href={`/taller/etiquetas?ciclo=${p.cicloId}&volver=menu`} className="btn btn-primary btn-sm whitespace-nowrap">
                      <Printer size={15} /> Imprimir todas
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-foreground-muted">Imprimir no cambia el stock: las cajas ya entraron al cerrar el turno o la producción. La reimpresión de algunas cajas queda en el historial con su motivo.</p>
    </div>
  );
}
