import Link from "next/link";
import { materialComprometido } from "@/lib/data/pedidos";
import { listarCiclos } from "@/lib/data/produccion";
import { fmtNumero, fmtFecha } from "@/lib/format";

export default async function ProduccionPage() {
  const [cola, ciclos] = await Promise.all([materialComprometido(), listarCiclos(30)]);
  const faltantes = cola.filter((c) => c.faltaProducir > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-brand-azul-oscuro">Producción</h1>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Cola — falta producir para cubrir pedidos
        </h2>
        {faltantes.length === 0 ? (
          <p className="text-sm text-foreground-muted">No hay faltantes hoy.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-foreground-muted">
                  <th className="p-3">Producto</th>
                  <th className="p-3">Comprometido</th>
                  <th className="p-3">Stock</th>
                  <th className="p-3">Falta producir</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {faltantes.map((f) => (
                  <tr key={f.productoId} className="border-b border-border last:border-0">
                    <td className="p-3">
                      {f.codigo} · {f.descripcion}
                    </td>
                    <td className="p-3">{fmtNumero(f.comprometido, 0)}</td>
                    <td className="p-3">{fmtNumero(f.stock, 0)}</td>
                    <td className="p-3 font-medium text-[var(--estado-critico-fg)]">
                      {fmtNumero(f.faltaProducir, 0)}
                    </td>
                    <td className="p-3 text-right">
                      <Link
                        href={`/produccion/nuevo?productoId=${f.productoId}`}
                        className="font-medium text-accent hover:underline"
                      >
                        Producir →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
            Ciclos
          </h2>
          <Link href="/produccion/nuevo" className="text-sm font-medium text-accent hover:underline">
            + Nuevo ciclo
          </Link>
        </div>
        {ciclos.length === 0 ? (
          <p className="text-sm text-foreground-muted">Todavía no se cargó ningún ciclo.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-foreground-muted">
                  <th className="p-3">Inicio</th>
                  <th className="p-3">Inyectora</th>
                  <th className="p-3">Producto</th>
                  <th className="p-3">Partida</th>
                  <th className="p-3">Operario</th>
                  <th className="p-3">Piezas producidas</th>
                  <th className="p-3">Estado</th>
                </tr>
              </thead>
              <tbody>
                {ciclos.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="p-3">
                      <Link href={`/produccion/${c.id}`} className="text-accent hover:underline">
                        {fmtFecha(c.fechaInicio)}
                      </Link>
                    </td>
                    <td className="p-3">{c.inyectora}</td>
                    <td className="p-3">
                      {c.productoCodigo ? `${c.productoCodigo} · ${c.productoDescripcion}` : "—"}
                    </td>
                    <td className="p-3">{c.partidaNumero ?? "—"}</td>
                    <td className="p-3">{c.operarioNombre ?? "—"}</td>
                    <td className="p-3">{c.piezasProducidas != null ? fmtNumero(c.piezasProducidas, 0) : "—"}</td>
                    <td className="p-3">
                      {c.fechaFin ? (
                        <span className="badge-ok rounded-full px-2 py-0.5 text-xs font-medium">Cerrado</span>
                      ) : (
                        <span className="badge-bajo rounded-full px-2 py-0.5 text-xs font-medium">Abierto</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
