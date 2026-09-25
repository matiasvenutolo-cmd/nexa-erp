import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerPedido } from "@/lib/data/pedidos";
import { disponiblePorProducto } from "@/lib/data/stock";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { getUsuarioActual } from "@/lib/session";
import { puedeVerPrecios } from "@/lib/auth/permisos";
import { EstadoPedido } from "@/components/estado-pedido";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/format";

export default async function DetallePedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pedidoId = Number(id);
  if (!Number.isFinite(pedidoId)) notFound();

  const [usuario, pedido, depositoId] = await Promise.all([
    getUsuarioActual(),
    obtenerPedido(pedidoId),
    getDepositoNexaId(),
  ]);
  if (!pedido) notFound();
  const verPrecios = puedeVerPrecios(usuario.rol);

  const productoIds = pedido.lineas.map((l) => l.productoId).filter((id): id is number => id != null);
  const disponible = await disponiblePorProducto(depositoId, productoIds, pedido.id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/pedidos" className="text-sm text-foreground-muted hover:text-foreground">
          ← Pedidos
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h1 className="text-xl font-semibold text-brand-azul-oscuro">{pedido.clienteNombre}</h1>
          <EstadoPedido estado={pedido.estado} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-4">
        <Dato label="Fecha" valor={fmtFecha(pedido.fechaPedido)} />
        <Dato label="Contacto" valor={pedido.contacto ?? "—"} />
        <Dato label="Entrega" valor={pedido.modoEntrega ?? "—"} />
        {verPrecios && <Dato label="Total" valor={fmtMoneda(pedido.total)} />}
        {pedido.domicilioEntrega && (
          <div className="col-span-2 sm:col-span-4">
            <Dato label="Domicilio" valor={pedido.domicilioEntrega} />
          </div>
        )}
        {pedido.requiereColocacion && (
          <div className="col-span-2 sm:col-span-4">
            <span className="badge-estado badge-bajo">Requiere servicio de colocación</span>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <th className="px-4 py-2.5">Producto</th>
              <th className="px-4 py-2.5 text-right">Pedido</th>
              <th className="px-4 py-2.5 text-right">Armado</th>
              <th className="px-4 py-2.5">Stock</th>
            </tr>
          </thead>
          <tbody>
            {pedido.lineas.map((l) => {
              const disp = l.productoId != null ? disponible.get(l.productoId) : undefined;
              return (
                <tr key={l.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    {l.productoDescripcion ? (
                      <>
                        <div className="font-medium text-foreground">{l.productoDescripcion}</div>
                        <div className="text-xs text-foreground-muted">{l.productoCodigo}</div>
                      </>
                    ) : (
                      <>
                        <div className="text-foreground-muted italic">Sin producto asignado</div>
                        {l.colorTexto && <div className="text-xs text-foreground-muted">Color: {l.colorTexto}</div>}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">{fmtNumero(l.unidadesPedidas, 0)}</td>
                  <td className="px-4 py-3 text-right text-foreground-muted">{fmtNumero(l.unidadesArmadas, 0)}</td>
                  <td className="px-4 py-3">
                    <EstadoStockLinea disponible={disp} pedido={l.unidadesPedidas} sinSku={l.productoId == null} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </div>

      {pedido.observaciones && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground-muted">Observaciones</div>
          {pedido.observaciones}
        </div>
      )}
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-foreground-muted">{label}</div>
      <div className="mt-0.5 text-foreground">{valor}</div>
    </div>
  );
}

function EstadoStockLinea({
  disponible,
  pedido,
  sinSku,
}: {
  disponible: number | undefined;
  pedido: number;
  sinSku: boolean;
}) {
  if (sinSku) return <span className="badge-estado bg-surface-muted text-foreground-muted">A asignar</span>;
  if (disponible == null) return <span className="badge-estado badge-critico">Sin stock</span>;
  if (disponible >= pedido) return <span className="badge-estado badge-ok">OK para armar</span>;
  if (disponible > 0)
    return <span className="badge-estado badge-bajo">Falta producir {fmtNumero(pedido - disponible, 0)}</span>;
  return <span className="badge-estado badge-critico">Falta producir {fmtNumero(pedido, 0)}</span>;
}
