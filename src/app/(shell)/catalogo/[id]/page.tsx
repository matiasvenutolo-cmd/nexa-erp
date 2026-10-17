import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes } from "lucide-react";
import { listarProductos } from "@/lib/data/catalogo";
import { existenciasProducto } from "@/lib/data/despachos";
import { materialComprometido } from "@/lib/data/pedidos";
import { etiquetaTipo } from "@/lib/etiquetas";
import { Semaforo } from "@/components/semaforo";
import { fmtFecha, fmtNumero } from "@/lib/format";

/**
 * Detalle de un producto de stock con «Ver existencias»: las cajas armadas
 * con su código y cantidad actual, marcando las abiertas (menos que la caja
 * completa) para encontrarlas rápido.
 */
export default async function ProductoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ existencias?: string; abiertas?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const p = (await listarProductos()).find((x) => x.id === Number(id));
  if (!p) notFound();
  const ver = sp.existencias === "1";
  const [ex, comp] = await Promise.all([ver ? existenciasProducto(p.id) : Promise.resolve(null), materialComprometido()]);
  const comprometido = comp.find((c) => c.productoId === p.id);
  const cajas = ex ? (sp.abiertas === "1" ? ex.cajas.filter((c) => !c.completa) : ex.cajas) : [];

  return (
    <div className="space-y-5">
      <div>
        <Link href="/catalogo" className="text-sm font-semibold text-foreground-muted hover:text-foreground">
          ← Stock de productos
        </Link>
        <div className="encabezado mb-0 mt-1">
          <div>
            <h1>
              {etiquetaTipo(p.familia, p.tipo)} · {p.colorNombre}
            </h1>
            <p>
              {p.codigo} · {p.descripcion}
            </p>
          </div>
          <Link href={ver ? `/catalogo/${p.id}` : `/catalogo/${p.id}?existencias=1`} className="btn btn-primary btn-lg">
            <Boxes size={20} /> {ver ? "Ocultar existencias" : "Ver existencias"}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="stat-card">
          <div className="stat-label">Stock</div>
          <div className="stat-valor">{fmtNumero(p.stock, 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Comprometido en pedidos</div>
          <div className="stat-valor">{fmtNumero(comprometido?.comprometido ?? 0, 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Falta producir</div>
          <div className="stat-valor">{fmtNumero(comprometido?.faltaProducir ?? 0, 0)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Mínimo / máximo</div>
          <div className="stat-valor">
            {fmtNumero(p.minimo, 0)} / {fmtNumero(p.maximo, 0)}
          </div>
          <Semaforo estado={p.estado} />
        </div>
      </div>

      {ex && (
        <section className="panel overflow-x-auto p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <h2 className="panel-titulo mb-0 w-auto border-0">
              Existencias: {ex.cajas.length} caja{ex.cajas.length === 1 ? "" : "s"}
              {ex.capacidad ? ` · caja completa = ${ex.capacidad} u.` : " · se guarda sin caja (accesorio)"}
            </h2>
            {ex.capacidad && (
              <div className="flex gap-1">
                <Link href={`/catalogo/${p.id}?existencias=1`} className={`btn btn-sm ${sp.abiertas !== "1" ? "btn-azul" : "btn-outline"}`}>
                  Todas
                </Link>
                <Link href={`/catalogo/${p.id}?existencias=1&abiertas=1`} className={`btn btn-sm ${sp.abiertas === "1" ? "btn-azul" : "btn-outline"}`}>
                  Sólo abiertas ({ex.cajas.filter((c) => !c.completa).length})
                </Link>
              </div>
            )}
          </div>
          <table className="tabla mt-3">
            <thead>
              <tr>
                <th>Código de caja</th>
                <th>Producto y color</th>
                <th>Partida NEXA</th>
                <th>Fecha</th>
                <th className="text-right">Cantidad actual</th>
                <th>Caja</th>
              </tr>
            </thead>
            <tbody>
              {cajas.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/trazabilidad?tipo=caja&valor=${c.codigo}`} className="font-mono text-accent hover:underline">
                      {c.codigo}
                    </Link>
                  </td>
                  <td>
                    {etiquetaTipo(p.familia, p.tipo)} · {p.colorNombre}
                  </td>
                  <td>N° {c.partidaNumero}</td>
                  <td>{fmtFecha(c.fecha)}</td>
                  <td className="text-right font-semibold tabular-nums">
                    {fmtNumero(c.disponible, 0)}
                    {c.capacidad ? <span className="font-normal text-foreground-muted"> / {c.capacidad}</span> : ""}
                  </td>
                  <td>{c.capacidad == null ? <span className="badge-estado badge-exceso">Sin caja estándar</span> : c.completa ? <span className="badge-estado badge-ok">Completa</span> : <span className="badge-estado badge-bajo">Abierta</span>}</td>
                </tr>
              ))}
              {cajas.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-foreground-muted">
                    {sp.abiertas === "1" ? "No hay cajas abiertas." : "No hay cajas con unidades disponibles."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="px-5 pb-4 pt-2 text-xs text-foreground-muted">
            En cajas: {fmtNumero(ex.enCajas, 0)} u. · Stock total: {fmtNumero(ex.stock, 0)} u.
            {ex.sinCaja > 0 && ` · ${fmtNumero(ex.sinCaja, 0)} u. sin caja (stock anterior a las cajas o accesorios: se arman leyendo el código del producto).`}
          </p>
        </section>
      )}
    </div>
  );
}
