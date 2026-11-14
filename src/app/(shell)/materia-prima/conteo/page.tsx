import Link from "next/link";
import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { conteosMp, planillaConteo, puedeContarMp } from "@/lib/data/conteo-mp";
import { fmtFecha, hoyISO } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";
import { PlanillaConteo } from "./planilla";

export default async function ConteoMpPage({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeContarMp(usuario.rol)) redirect("/materia-prima");
  const sp = await searchParams;
  const hoy = hoyISO();
  const fecha = sp.fecha && /^\d{4}-\d{2}-\d{2}$/.test(sp.fecha) && sp.fecha <= hoy ? sp.fecha : hoy;
  const [filas, anteriores] = await Promise.all([planillaConteo(fecha), conteosMp()]);
  return (
    <div className="space-y-6">
      <div>
        <Link href="/materia-prima" className="text-sm text-foreground-muted hover:text-foreground">
          ← Materia prima
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Conteo físico de materia prima</h1>
        <p className="text-sm text-foreground-muted">Stock general (depósito de Materia prima). El stock teórico es el del sistema al cierre del día del recuento.</p>
      </div>
      <form className="flex items-end gap-2">
        <label className="text-sm">
          Fecha del recuento
          <input type="date" name="fecha" defaultValue={fecha} max={hoy} className="input mt-1 block" />
        </label>
        <button className="btn btn-outline">Ver</button>
      </form>
      <PlanillaConteo key={fecha} filas={filas} fecha={fecha} />
      {anteriores.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-semibold text-brand-azul-oscuro">Conteos anteriores</h2>
          {anteriores.map((c) => {
            const conDif = c.lineas.filter((l) => l.diferencia !== 0);
            return (
              <details key={c.id} className="rounded border border-border p-3">
                <summary className="cursor-pointer text-sm">
                  <b>{fmtFecha(c.fecha)}</b> · {c.responsable} · {c.lineas.length} {c.lineas.length === 1 ? "material" : "materiales"} · {conDif.length === 0 ? "sin diferencias" : `${conDif.length} con diferencia`}
                  {c.observaciones && <span className="text-foreground-muted"> · {c.observaciones}</span>}
                </summary>
                <table className="tabla mt-2">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th className="text-right">Teórico</th>
                      <th className="text-right">Físico</th>
                      <th className="text-right">Diferencia</th>
                      <th>Justificación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.lineas.map((l) => (
                      <tr key={l.codigo}>
                        <td>{l.nombre}</td>
                        <td className="text-right tabular-nums">{fmtPeso(l.sistema)}</td>
                        <td className="text-right tabular-nums">{fmtPeso(l.contado)}</td>
                        <td className={`whitespace-nowrap text-right tabular-nums ${l.diferencia !== 0 ? "font-semibold text-red-700" : ""}`}>{l.diferencia === 0 ? "—" : `${l.diferencia > 0 ? "+" : "−"}${fmtPeso(Math.abs(l.diferencia))}`}</td>
                        <td>{l.motivo}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            );
          })}
        </section>
      )}
    </div>
  );
}
