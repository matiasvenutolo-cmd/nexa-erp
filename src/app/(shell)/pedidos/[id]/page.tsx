import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerPedido, remitoInterno, PRIORIDAD_URGENTE } from "@/lib/data/pedidos";
import { obtenerParametros } from "@/lib/data/parametros";
import { listarAuditoria } from "@/lib/data/auditoria";
import { desglosarCajas, unidadesPorCaja } from "@/lib/data/catalogo";
import { disponiblePorProducto } from "@/lib/data/stock";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { getUsuarioActual } from "@/lib/session";
import { puedeVerPrecios, puedeCrearPedido, puedeCambiarPrioridad } from "@/lib/auth/permisos";
import { EstadoPedido } from "@/components/estado-pedido";
import { AccionesPedido } from "./acciones-pedido";
import { ControlUrgencia } from "./urgencia";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/format";

export default async function DetallePedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pedidoId = Number(id);
  if (!Number.isFinite(pedidoId)) notFound();

  const [usuario, pedido, depositoId, parametros, cambiosPrioridad] = await Promise.all([
    getUsuarioActual(),
    obtenerPedido(pedidoId),
    getDepositoNexaId(),
    obtenerParametros(),
    listarAuditoria({ entidad: "pedido", entidadId: pedidoId, limite: 1 }),
  ]);
  if (!pedido) notFound();
  const urgente = pedido.prioridad <= PRIORIDAD_URGENTE;
  const abierto = pedido.estado !== "ENTREGADO" && pedido.estado !== "CANCELADO";
  const verPrecios = puedeVerPrecios(usuario.rol);

  const productoIds = pedido.lineas.map((l) => l.productoId).filter((id): id is number => id != null);
  const disponible = await disponiblePorProducto(depositoId, productoIds, pedido.id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/pedidos" className="text-sm text-foreground-muted hover:text-foreground">
          ← Pedidos
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-brand-azul-oscuro">{pedido.clienteNombre}</h1>
            <EstadoPedido estado={pedido.estado} />
            {urgente && abierto && <span className="badge-estado badge-critico">Urgente</span>}
          </div>
          {puedeCrearPedido(usuario.rol) && (
            <div className="flex items-center gap-3">
              {pedido.estado !== "ENTREGADO" && pedido.estado !== "CANCELADO" && (
                <Link href={`/pedidos/${pedido.id}/editar`} className="text-sm font-medium text-accent hover:underline">
                  Editar
                </Link>
              )}
              <AccionesPedido pedidoId={pedido.id} estado={pedido.estado} />
            </div>
          )}
        </div>
      </div>

      {abierto && (urgente || puedeCambiarPrioridad(usuario.rol)) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <span className="text-foreground-muted">
            {urgente
              ? `Urgente para producción${cambiosPrioridad[0]?.motivo ? `: ${cambiosPrioridad[0].motivo}` : ""}${
                  cambiosPrioridad[0] ? ` (${cambiosPrioridad[0].usuarioNombre})` : ""
                }`
              : "Prioridad de producción automática, por fecha de entrega."}
          </span>
          {puedeCambiarPrioridad(usuario.rol) && <ControlUrgencia pedidoId={pedido.id} urgente={urgente} />}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-4">
        <Dato label="Fecha" valor={fmtFecha(pedido.fechaPedido)} />
        <Dato label="Entrega comprometida" valor={pedido.fechaEntregaPactada ? fmtFecha(pedido.fechaEntregaPactada) : "—"} />
        <Dato label="Contacto" valor={pedido.contacto ?? "—"} />
        <Dato label="Entrega" valor={pedido.modoEntrega ?? "—"} />
        {verPrecios && <Dato label="Total" valor={fmtMoneda(pedido.total)} />}
        {verPrecios && pedido.senia != null && <Dato label="Seña" valor={fmtMoneda(pedido.senia)} />}
        {verPrecios && pedido.metodoPago && <Dato label="Método de pago" valor={pedido.metodoPago} />}
        {verPrecios && pedido.numeroComprobante && (
          <Dato label="N° de comprobante" valor={pedido.numeroComprobante} />
        )}
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
                  <td className="px-4 py-3 text-right">
                    {fmtNumero(l.unidadesPedidas, 0)}
                    <Cajas
                      unidades={l.unidadesPedidas}
                      porCaja={
                        l.productoId != null
                          ? unidadesPorCaja(
                              { esAccesorio: l.productoEsAccesorio ?? false, unidadesPorCaja: l.productoUnidadesPorCaja },
                              parametros,
                            )
                          : null
                      }
                    />
                  </td>
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

      {pedido.despachos.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">Remitos</div>
          <ul className="space-y-1">
            {pedido.despachos.map((d) => (
              <li key={d.id}>
                <span className="font-medium">{remitoInterno(d.numeroInterno)}</span>
                <span className="text-foreground-muted"> · {fmtFecha(d.fecha)}</span>
                {d.numeroRemito && <span className="text-foreground-muted"> · remito legal {d.numeroRemito}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

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

/** Pisos: cajas cerradas + caja abierta con sueltas (respuesta 4 de Definiciones pendientes). */
function Cajas({ unidades, porCaja }: { unidades: number; porCaja: number | null }) {
  const d = desglosarCajas(unidades, porCaja);
  if (!d) return null;
  const partes = [];
  if (d.cajas > 0) partes.push(`${d.cajas} caja${d.cajas === 1 ? "" : "s"}`);
  if (d.sueltas > 0) partes.push(`${d.sueltas} suelta${d.sueltas === 1 ? "" : "s"}`);
  return <div className="text-xs text-foreground-muted">{partes.join(" + ")}</div>;
}
