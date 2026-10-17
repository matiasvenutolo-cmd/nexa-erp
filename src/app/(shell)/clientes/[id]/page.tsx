import Link from "next/link";
import { notFound } from "next/navigation";
import { getCliente, historialCliente } from "@/lib/data/clientes";
import { getUsuarioActual } from "@/lib/session";
import { puedeCrearPedido } from "@/lib/auth/permisos";
import { verPrecios as verPreciosDe } from "@/lib/vista";
import { remitoInterno } from "@/lib/data/despachos";
import { EstadoPedido } from "@/components/estado-pedido";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/format";

/** Detalle del cliente: sus datos (editables) y el historial de pedidos. */
export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCliente(Number(id));
  if (!c) notFound();
  const usuario = await getUsuarioActual();
  const [pedidos, conPrecios] = await Promise.all([historialCliente(c.id), verPreciosDe(usuario)]);
  const abiertos = pedidos.filter((p) => p.estado !== "ENTREGADO" && p.estado !== "CANCELADO").length;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/clientes" className="text-sm font-semibold text-foreground-muted hover:text-foreground">
          ← Clientes
        </Link>
        <div className="encabezado mb-0 mt-1">
          <div>
            <h1>{c.nombre}</h1>
            <p>
              {[c.telefono, [c.domicilio, c.localidad].filter(Boolean).join(", "), c.cuit ? `CUIT ${c.cuit}` : null].filter(Boolean).join(" · ") || "Sin datos de contacto"}
            </p>
          </div>
          {puedeCrearPedido(usuario.rol) && (
            <div className="flex gap-2">
              <Link href={`/clientes/${c.id}/editar`} className="btn btn-outline">
                Editar datos
              </Link>
              <Link href="/pedidos/nuevo" className="btn btn-primary">
                + Nuevo pedido
              </Link>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="stat-card">
          <div className="stat-label">Pedidos</div>
          <div className="stat-valor">{pedidos.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Abiertos</div>
          <div className="stat-valor">{abiertos}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Último pedido</div>
          <div className="stat-valor">{pedidos[0] ? fmtFecha(pedidos[0].fechaPedido) : "—"}</div>
        </div>
      </div>

      <section className="panel overflow-x-auto p-0">
        <h2 className="panel-titulo mx-5 mt-4">Historial de pedidos</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Pedido</th>
              <th>Ingreso</th>
              <th>Entrega</th>
              <th>Productos</th>
              <th>Despachos</th>
              {conPrecios && <th className="text-right">Total</th>}
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => (
              <tr key={p.id}>
                <td>
                  <Link href={`/pedidos/${p.id}`} className="font-semibold text-accent hover:underline">
                    #{p.id}
                  </Link>
                  {p.numeroOrden && !p.numeroOrden.startsWith("IMPORT-") && <div className="text-xs text-foreground-muted">N° {p.numeroOrden}</div>}
                  {p.archivado && <div className="text-xs text-foreground-muted">archivado</div>}
                </td>
                <td className="whitespace-nowrap">{fmtFecha(p.fechaPedido)}</td>
                <td className="whitespace-nowrap">{p.fechaEntrega ? fmtFecha(p.fechaEntrega) : "—"}</td>
                <td className="text-xs">
                  {p.lineas.map((l, i) => (
                    <div key={i}>
                      {fmtNumero(l.unidades, 0)} × {l.codigo ?? l.colorTexto ?? "sin producto"}
                      {l.entregadas > 0 && <span className="text-foreground-muted"> ({fmtNumero(l.entregadas, 0)} entregadas)</span>}
                    </div>
                  ))}
                </td>
                <td className="text-xs">
                  {p.despachos.length === 0
                    ? "—"
                    : p.despachos.map((d) => (
                        <div key={d.id}>
                          {d.estado === "ENTREGADO" ? (
                            <Link href={`/pedidos/${p.id}/remito/${d.id}`} className="text-accent hover:underline">
                              Remito {remitoInterno(d.numeroInterno)}
                            </Link>
                          ) : (
                            <span>{d.estado === "ARMANDO" ? "En armado" : "Listo para despachar"}</span>
                          )}
                          {d.entregadoEn && <span className="text-foreground-muted"> · {fmtFecha(d.entregadoEn)}</span>}
                        </div>
                      ))}
                </td>
                {conPrecios && <td className="text-right">{fmtMoneda(p.total)}</td>}
                <td>
                  <EstadoPedido estado={p.estado} />
                </td>
              </tr>
            ))}
            {pedidos.length === 0 && (
              <tr>
                <td colSpan={conPrecios ? 7 : 6} className="text-foreground-muted">
                  Este cliente todavía no tiene pedidos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
