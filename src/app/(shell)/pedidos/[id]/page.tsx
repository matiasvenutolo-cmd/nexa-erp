import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ESTADO_LABEL,
  MOTIVOS_PRIORIDAD,
  NIVELES_PRIORIDAD,
  PRIORIDAD_AUTOMATICA,
  compatibilidadRenglon,
  coberturaPorLinea,
  etiquetaPrioridad,
  obtenerPedido,
} from "@/lib/data/pedidos";
import { claveColor } from "@/lib/catalogo-normalizacion";
import { listarDespachos, remitoInterno, situacionLineas, type DespachoDetalle } from "@/lib/data/despachos";
import { obtenerParametros } from "@/lib/data/parametros";
import { listarAuditoria } from "@/lib/data/auditoria";
import { listarReclamos, ESTADO_RECLAMO_LABEL } from "@/lib/data/reclamos";
import { colaProduccion } from "@/lib/data/produccion";
import { desglosarCajas, listarProductos, unidadesPorCaja } from "@/lib/data/catalogo";
import { getUsuarioActual } from "@/lib/session";
import {
  puedeCambiarPrioridad,
  puedeCrearPedido,
  puedeCrearReclamo,
  puedeOperarDespacho,
  puedeRegistrarRemitoLegal,
  puedeVerPrecios,
  puedeVerReclamos,
} from "@/lib/auth/permisos";
import { EstadoPedido } from "@/components/estado-pedido";
import { CancelarPedido } from "./acciones-pedido";
import { BotonPrepararDespacho, ControlPrioridad, VincularProducto } from "./urgencia";
import { RemitoLegal } from "./remito-legal";
import { fmtFecha, fmtFechaHora, fmtMoneda, fmtNumero } from "@/lib/format";

export default async function DetallePedidoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ entregado?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const pedidoId = Number(id);
  if (!Number.isFinite(pedidoId)) notFound();

  const [usuario, pedido, parametros] = await Promise.all([getUsuarioActual(), obtenerPedido(pedidoId), obtenerParametros()]);
  if (!pedido) notFound();
  const rol = usuario.rol;
  const abierto = pedido.estado !== "ENTREGADO" && pedido.estado !== "CANCELADO";

  const [lineas, despachos, cambiosPrioridad, reclamos, cola] = await Promise.all([
    situacionLineas(pedidoId),
    listarDespachos(pedidoId),
    listarAuditoria({ entidad: "pedido", entidadId: pedidoId, limite: 20 }),
    puedeVerReclamos(rol) ? listarReclamos({ pedidoId }) : Promise.resolve([]),
    abierto ? colaProduccion() : Promise.resolve([]),
  ]);
  const ultimoCambioPrioridad = cambiosPrioridad.find((c) => c.campo === "prioridad");
  const sinProducto = lineas.filter((l) => l.productoId == null);
  const productos = sinProducto.length && abierto ? await listarProductos() : [];
  const coloresConocidos = [...new Set(productos.map((p) => p.colorNombre))];
  const puedeVincular = abierto && puedeCrearPedido(rol);
  // Misma cuenta que la lista de pedidos y la cola: el stock se reparte por prioridad.
  const cobertura = await coberturaPorLinea(lineas.map((l) => l.productoId).filter((x): x is number => x != null));
  const activo = despachos.find((d) => d.estado === "ARMANDO" || d.estado === "CONTROLADO");
  const hayPendienteDespachable = lineas.some((l) => l.productoId != null && l.pendiente > 0);
  const lineaPorId = new Map(pedido.lineas.map((l) => [l.id, l]));
  const posicionEnCola = new Map(cola.map((f, i) => [f.productoId, { posicion: i + 1, total: cola.length }]));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/pedidos" className="text-sm text-foreground-muted hover:text-foreground">
          ← Pedidos
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold text-brand-azul-oscuro">
              #{pedido.id} · {pedido.clienteNombre}
            </h1>
            <EstadoPedido estado={pedido.estado} />
            {abierto && pedido.prioridad !== PRIORIDAD_AUTOMATICA && (
              <span className={`badge-estado ${pedido.prioridad < 0 ? "badge-critico" : "badge-exceso"}`}>
                {etiquetaPrioridad(pedido.prioridad)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            {puedeCrearReclamo(rol) && (
              <Link href={`/reclamos/nuevo?pedido=${pedido.id}`} className="text-sm font-medium text-accent hover:underline">
                Registrar reclamo
              </Link>
            )}
            {puedeCrearPedido(rol) && abierto && (
              <>
                <Link href={`/pedidos/${pedido.id}/editar`} className="text-sm font-medium text-accent hover:underline">
                  Editar
                </Link>
                <CancelarPedido pedidoId={pedido.id} />
              </>
            )}
          </div>
        </div>
      </div>

      {sp.entregado && (
        <div className="rounded-md bg-[var(--estado-ok-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-ok-fg)]">
          Entrega registrada con el remito interno {sp.entregado}.
        </div>
      )}

      {!activo && (pedido.estado === "LISTO_PARA_DESPACHAR" || pedido.estado === "EN_ARMADO") && (
        <div className="rounded-md bg-[var(--estado-bajo-bg)] px-3 py-2 text-sm text-[var(--estado-bajo-fg)]">
          El estado “{ESTADO_LABEL[pedido.estado]}” viene de la importación del Excel: este pedido no tiene armado ni control en
          el sistema. Su situación real es la de los renglones de abajo; para despacharlo hay que prepararlo y controlarlo.
        </div>
      )}

      {/* Despacho */}
      {abierto && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          {activo ? (
            <EstadoControles d={activo} />
          ) : (
            <span className="text-foreground-muted">
              {hayPendienteDespachable
                ? "Sin despacho en curso."
                : sinProducto.length
                  ? "Hay renglones sin producto (datos pendientes del Excel): no se pueden armar hasta vincularlos a un producto."
                  : "No queda nada pendiente de entregar."}
            </span>
          )}
          {puedeOperarDespacho(rol) &&
            (activo ? (
              <Link
                href={`/pedidos/${pedido.id}/despacho`}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
              >
                {activo.estado === "ARMANDO" ? "Continuar armado →" : "Hacer control final →"}
              </Link>
            ) : (
              hayPendienteDespachable && <BotonPrepararDespacho pedidoId={pedido.id} />
            ))}
        </div>
      )}

      {/* Prioridad de inyección */}
      {abierto && (
        <div className="space-y-2 rounded-lg border border-border bg-surface px-4 py-3 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span>
              <span className="font-medium">Prioridad de producción: {etiquetaPrioridad(pedido.prioridad)}</span>
              {ultimoCambioPrioridad && (
                <span className="text-foreground-muted">
                  {" "}
                  — cambiada por {ultimoCambioPrioridad.usuarioNombre} el {fmtFechaHora(ultimoCambioPrioridad.creadoEn)}
                  {ultimoCambioPrioridad.motivo ? ` (${ultimoCambioPrioridad.motivo})` : ""}
                </span>
              )}
            </span>
            <span className="text-xs text-foreground-muted">
              Entrega comprometida: {pedido.fechaEntregaPactada ? fmtFecha(pedido.fechaEntregaPactada) : "sin fecha (cuenta la del pedido)"}
            </span>
          </div>
          {lineas.some((l) => l.productoId != null && posicionEnCola.has(l.productoId)) && (
            <ul className="text-xs text-foreground-muted">
              {lineas
                .filter((l) => l.productoId != null && posicionEnCola.has(l.productoId))
                .map((l) => {
                  const p = posicionEnCola.get(l.productoId!)!;
                  return (
                    <li key={l.lineaId}>
                      {l.productoCodigo}: puesto {p.posicion} de {p.total} en la cola de producción
                    </li>
                  );
                })}
            </ul>
          )}
          {puedeCambiarPrioridad(rol) && (
            <ControlPrioridad pedidoId={pedido.id} actual={pedido.prioridad} niveles={NIVELES_PRIORIDAD} motivos={MOTIVOS_PRIORIDAD} />
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-4">
        <Dato label="Fecha" valor={fmtFecha(pedido.fechaPedido)} />
        <Dato label="Entrega comprometida" valor={pedido.fechaEntregaPactada ? fmtFecha(pedido.fechaEntregaPactada) : "—"} />
        <Dato label="Contacto" valor={pedido.contacto ?? "—"} />
        <Dato label="Entrega" valor={pedido.modoEntrega ?? "—"} />
        {puedeVerPrecios(rol) && <Dato label="Total" valor={fmtMoneda(pedido.total)} />}
        {puedeVerPrecios(rol) && pedido.senia != null && <Dato label="Seña" valor={fmtMoneda(pedido.senia)} />}
        {puedeVerPrecios(rol) && pedido.metodoPago && <Dato label="Método de pago" valor={pedido.metodoPago} />}
        {puedeVerPrecios(rol) && pedido.numeroComprobante && <Dato label="N° de comprobante" valor={pedido.numeroComprobante} />}
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
                <th className="px-4 py-2.5 text-right">Entregado</th>
                <th className="px-4 py-2.5 text-right">En despacho</th>
                <th className="px-4 py-2.5 text-right">Pendiente</th>
                <th className="px-4 py-2.5">Stock</th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l) => {
                const det = lineaPorId.get(l.lineaId);
                const porCaja =
                  l.productoId != null && det
                    ? unidadesPorCaja({ esAccesorio: det.productoEsAccesorio ?? false, unidadesPorCaja: det.productoUnidadesPorCaja }, parametros)
                    : null;
                return (
                  <tr key={l.lineaId} className="border-b border-border align-top last:border-0">
                    <td className="px-4 py-3">
                      {l.productoDescripcion ? (
                        <>
                          <div className="font-medium text-foreground">{l.productoDescripcion}</div>
                          <div className="text-xs text-foreground-muted">{l.productoCodigo}</div>
                        </>
                      ) : (
                        <RenglonSinProducto
                          colorTexto={l.colorTexto}
                          unidades={l.pedido}
                          compat={compatibilidadRenglon(l.colorTexto, coloresConocidos)}
                          vincular={
                            puedeVincular
                              ? (compat) => (
                                  <VincularProducto
                                    pedidoId={pedido.id}
                                    lineaId={l.lineaId}
                                    requiereConfirmacion={compat.tipo === "sin-dato"}
                                    productos={productos.filter(
                                      (p) => compat.tipo === "sin-dato" || (compat.tipo === "color" && claveColor(p.colorNombre) === claveColor(compat.colorNombre)),
                                    )}
                                  />
                                )
                              : null
                          }
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{fmtNumero(l.pedido, 0)}</td>
                    <td className="px-4 py-3 text-right">{fmtNumero(l.entregado, 0)}</td>
                    <td className="px-4 py-3 text-right text-foreground-muted">{l.enDespacho ? fmtNumero(l.enDespacho, 0) : "—"}</td>
                    <td className="px-4 py-3 text-right font-medium">
                      {fmtNumero(l.pendiente, 0)}
                      <Cajas unidades={l.pendiente} porCaja={porCaja} />
                    </td>
                    <td className="px-4 py-3">
                      {l.pendiente + l.enDespacho === 0 ? (
                        <span className="badge-estado badge-ok">Entregado</span>
                      ) : (
                        <EstadoStockLinea falta={cobertura.get(l.lineaId)?.faltaProducir ?? l.pendiente} sinSku={l.productoId == null} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {despachos.some((d) => d.estado === "ENTREGADO") && (
        <section className="rounded-lg border border-border bg-surface">
          <h2 className="border-b border-border px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-foreground-muted">Remitos</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  <th className="px-4 py-2">Remito interno</th>
                  <th className="px-4 py-2">Fecha</th>
                  <th className="px-4 py-2">Estado</th>
                  <th className="px-4 py-2">Remito legal</th>
                  <th className="px-4 py-2">Registrado por</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {despachos
                  .filter((d) => d.estado === "ENTREGADO")
                  .map((d) => (
                    <tr key={d.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 font-mono font-medium">{remitoInterno(d.numeroInterno)}</td>
                      <td className="px-4 py-2">{d.entregadoEn ? fmtFechaHora(d.entregadoEn) : fmtFecha(d.fecha)}</td>
                      <td className="px-4 py-2">
                        <span className="badge-estado badge-ok">Entregado</span>
                      </td>
                      <td className="px-4 py-2 font-mono">{d.numeroRemito ?? <span className="font-sans text-foreground-muted">sin registrar</span>}</td>
                      <td className="px-4 py-2 text-foreground-muted">
                        {d.remitoLegalPorNombre ? `${d.remitoLegalPorNombre}${d.remitoLegalEn ? `, ${fmtFechaHora(d.remitoLegalEn)}` : ""}` : "—"}
                      </td>
                      <td className="px-4 py-2">
                        <Link href={`/pedidos/${pedido.id}/remito/${d.id}`} className="text-accent hover:underline">
                          Ver / imprimir (original y duplicado)
                        </Link>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="border-t border-border px-4 py-2 text-xs text-foreground-muted">
            El remito interno se numera solo al confirmar el control final. El remito legal lo registra Administración en el despacho
            correspondiente (abajo).
          </p>
        </section>
      )}

      {despachos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">Despachos</h2>
          {despachos.map((d) => (
            <TarjetaDespacho key={d.id} d={d} pedidoId={pedido.id} puedeRemitoLegal={puedeRegistrarRemitoLegal(rol)} />
          ))}
        </section>
      )}

      {reclamos.length > 0 && (
        <section className="rounded-lg border border-border bg-surface p-4 text-sm">
          <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">Reclamos</h2>
          <ul className="space-y-1">
            {reclamos.map((r) => (
              <li key={r.id}>
                <Link href={`/reclamos/${r.id}`} className="font-medium text-accent hover:underline">
                  Reclamo #{r.id}
                </Link>{" "}
                <span className="text-foreground-muted">
                  · {ESTADO_RECLAMO_LABEL[r.estado]} · {r.descripcion}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pedido.observaciones && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-foreground-muted">Observaciones</div>
          {pedido.observaciones}
        </div>
      )}
      <p className="text-xs text-foreground-muted">Estado: {ESTADO_LABEL[pedido.estado]}</p>
    </div>
  );
}

function EstadoControles({ d }: { d: DespachoDetalle }) {
  return (
    <div className="space-y-0.5">
      <div className="font-medium">Despacho en curso</div>
      <div className="text-foreground-muted">
        {d.control1En ? (
          <>✓ Primer control realizado por {d.control1PorNombre} el {fmtFechaHora(d.control1En)}</>
        ) : (
          <>○ Pendiente de primer control (armado)</>
        )}
      </div>
      <div className="text-foreground-muted">
        {d.controlFinalEn ? <>✓ Control final realizado</> : <>○ Pendiente de control final</>}
      </div>
    </div>
  );
}

const ESTADO_DESPACHO_LABEL: Record<DespachoDetalle["estado"], string> = {
  ARMANDO: "En armado — pendiente de primer control",
  CONTROLADO: "Primer control realizado — pendiente de control final",
  ENTREGADO: "Entregado",
  ANULADO: "Anulado",
};

function TarjetaDespacho({ d, pedidoId, puedeRemitoLegal }: { d: DespachoDetalle; pedidoId: number; puedeRemitoLegal: boolean }) {
  const mismoControlador = d.control1PorId != null && d.controladoPorId != null && d.control1PorId === d.controladoPorId;
  const unidades = d.lineas.length
    ? d.lineas
    : d.piqueos
        .filter((p) => p.tipo === "ARMADO" && !p.conAlerta)
        .reduce<{ lineaId: number; productoCodigo: string | null; productoDescripcion: string | null; unidades: number }[]>((acc, p) => {
          const ya = acc.find((x) => x.productoCodigo === p.productoCodigo);
          if (ya) ya.unidades += p.cantidad;
          else acc.push({ lineaId: p.id, productoCodigo: p.productoCodigo, productoDescripcion: null, unidades: p.cantidad });
          return acc;
        }, []);
  return (
    <details className="rounded-lg border border-border bg-surface p-4 text-sm" open={d.estado !== "ANULADO"}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
        <span className="font-semibold">{d.estado === "ENTREGADO" ? `Remito interno ${remitoInterno(d.numeroInterno)}` : `Despacho #${d.id}`}</span>
        <span className={`badge-estado ${d.estado === "ENTREGADO" ? "badge-ok" : d.estado === "ANULADO" ? "bg-surface-muted text-foreground-muted" : "badge-bajo"}`}>
          {ESTADO_DESPACHO_LABEL[d.estado]}
        </span>
        {d.entregadoEn && <span className="text-foreground-muted">Entregado {fmtFechaHora(d.entregadoEn)}</span>}
        {d.estado !== "ENTREGADO" && d.estado !== "ANULADO" && (
          <span className="text-xs text-foreground-muted">El remito interno se asigna al confirmar el control final.</span>
        )}
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-xs font-medium uppercase text-foreground-muted">Productos</div>
          <ul>
            {unidades.map((l) => (
              <li key={l.lineaId}>
                {l.productoCodigo ?? "—"} × {fmtNumero(l.unidades, 0)}
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-1 text-foreground-muted">
          <div>Armado iniciado por {d.creadoPorNombre ?? "—"}</div>
          <div>
            Primer control: {d.control1En ? `${d.control1PorNombre}, ${fmtFechaHora(d.control1En)}` : "pendiente"}
            {d.control1Resultado && <div className="text-xs">{d.control1Resultado}</div>}
          </div>
          <div>
            Control final: {d.controlFinalEn ? `${d.controlFinalPorNombre}, ${fmtFechaHora(d.controlFinalEn)}` : "pendiente"}
            {d.controlFinalResultado && <div className="text-xs">{d.controlFinalResultado}</div>}
          </div>
          {mismoControlador && <div className="text-xs">Los dos controles los hizo la misma persona.</div>}
          {d.estado === "ANULADO" && d.observaciones && <div className="text-xs">{d.observaciones}</div>}
        </div>
      </div>
      {d.estado === "ENTREGADO" && (
        <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3">
          <Link href={`/pedidos/${pedidoId}/remito/${d.id}`} className="text-sm font-medium text-accent hover:underline">
            Ver / imprimir remito (original y duplicado)
          </Link>
          <span className="text-foreground-muted">
            Remito legal: {d.numeroRemito ?? "sin registrar"}
            {d.remitoLegalPorNombre && ` (${d.remitoLegalPorNombre}${d.remitoLegalEn ? `, ${fmtFechaHora(d.remitoLegalEn)}` : ""})`}
          </span>
          {puedeRemitoLegal && <RemitoLegal pedidoId={pedidoId} despachoId={d.id} actual={d.numeroRemito} />}
        </div>
      )}
    </details>
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

/** Pisos: cajas cerradas + caja abierta con sueltas (respuesta 4 de Definiciones pendientes). */
function Cajas({ unidades, porCaja }: { unidades: number; porCaja: number | null }) {
  const d = desglosarCajas(unidades, porCaja);
  if (!d) return null;
  const partes = [];
  if (d.cajas > 0) partes.push(`${d.cajas} caja${d.cajas === 1 ? "" : "s"}`);
  if (d.sueltas > 0) partes.push(`${d.sueltas} suelta${d.sueltas === 1 ? "" : "s"}`);
  return <div className="text-xs font-normal text-foreground-muted">{partes.join(" + ")}</div>;
}

type Compat = ReturnType<typeof compatibilidadRenglon>;

/** Renglón importado del Excel sin producto: dato pendiente hasta vincularlo al producto exacto. */
function RenglonSinProducto({
  colorTexto,
  unidades,
  compat,
  vincular,
}: {
  colorTexto: string | null;
  unidades: number;
  compat: Compat;
  vincular: ((c: Compat) => React.ReactNode) | null;
}) {
  return (
    <div>
      <div className="font-medium text-foreground">Dato pendiente: renglón sin producto</div>
      <div className="text-xs text-foreground-muted">
        Importado del Excel — color: {colorTexto ? `“${colorTexto}”` : "sin dato"} · {fmtNumero(unidades, 0)} u.
      </div>
      {compat.tipo === "multicolor" && (
        <div className="mt-1 text-xs text-[var(--estado-bajo-fg)]">
          Nombra varios colores para una sola cantidad: falta saber cuántas unidades de cada color. Se resuelve con el cliente; no se
          puede vincular a un producto.
        </div>
      )}
      {compat.tipo === "irreconocible" && (
        <div className="mt-1 text-xs text-[var(--estado-bajo-fg)]">
          El texto no identifica un único color del catálogo: hay que confirmar el color con el cliente.
        </div>
      )}
      {(compat.tipo === "color" || compat.tipo === "sin-dato") && vincular?.(compat)}
    </div>
  );
}

function EstadoStockLinea({ falta, sinSku }: { falta: number; sinSku: boolean }) {
  if (sinSku) return <span className="badge-estado bg-surface-muted text-foreground-muted">Dato pendiente</span>;
  if (falta === 0) return <span className="badge-estado badge-ok">Stock disponible para armar</span>;
  return <span className="badge-estado badge-critico">Falta producir {fmtNumero(falta, 0)}</span>;
}
