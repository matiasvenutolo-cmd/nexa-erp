import Link from "next/link";
import { Suspense } from "react";
import {
  contarPedidosPorEstado,
  disponibilidadArmado,
  etiquetaPrioridad,
  listarPedidos,
  situacionPedidos,
  ESTADO_LABEL,
  type OrdenPedidos,
  type SituacionPedido,
} from "@/lib/data/pedidos";
import { listarDespachosActivos } from "@/lib/data/despachos";
import { alertaEntrega } from "@/lib/data/planificacion";
import { ROLES_ESTRUCTURA, puedeCrearPedido, puedeOperarDespacho } from "@/lib/auth/permisos";
import { getUsuarioActual } from "@/lib/session";
import { verPrecios as verPreciosDe } from "@/lib/vista";
import { EstadoPedido } from "@/components/estado-pedido";
import { Toast } from "@/components/toast";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/format";
import { BotonPrepararDespacho } from "./[id]/urgencia";

const FILTROS = ["PEDIDO", "EN_ARMADO", "LISTO_PARA_DESPACHAR", "PARCIALMENTE_DESPACHADO", "ENTREGADO"] as const;
const ORDENES: { id: OrdenPedidos; label: string }[] = [
  { id: "fecha", label: "Fecha de pedido" },
  { id: "cliente", label: "Cliente (A-Z)" },
  { id: "entrega", label: "Fecha de entrega" },
];

/**
 * Pedidos (listado de mejoras): lo más nuevo arriba, orden por fecha de
 * pedido, cliente o entrega; vista «A armar» con «Comenzar a armar pedido»
 * según la disponibilidad real, y «Listos para despachar» con «Despachar».
 * El material comprometido pasó a Stock de productos.
 */
export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string; q?: string; archivados?: string; orden?: string; vista?: string; creado?: string; ok?: string }>;
}) {
  const sp = await searchParams;
  const vista = sp.vista === "armar" ? "armar" : sp.vista === "despachar" || sp.estado === "LISTO_PARA_DESPACHAR" ? "despachar" : "todos";
  const estadoValido = vista === "todos" && (FILTROS as readonly string[]).includes(sp.estado ?? "") ? (sp.estado as (typeof FILTROS)[number]) : undefined;
  const orden: OrdenPedidos = ORDENES.some((o) => o.id === sp.orden) ? (sp.orden as OrdenPedidos) : "fecha";
  const usuario = await getUsuarioActual();
  const estados = vista === "armar" ? (["PEDIDO", "EN_ARMADO", "PARCIALMENTE_DESPACHADO"] as const) : vista === "despachar" ? (["LISTO_PARA_DESPACHAR"] as const) : estadoValido;
  const [pedidos, conteos] = await Promise.all([
    listarPedidos(estados ? [...(Array.isArray(estados) ? estados : [estados])] : undefined, { archivados: sp.archivados === "1", orden }),
    contarPedidosPorEstado(),
  ]);
  const verPrecios = await verPreciosDe(usuario);
  const despacha = puedeOperarDespacho(usuario.rol);
  const texto = sp.q?.trim().toLowerCase();
  const visibles = texto ? pedidos.filter((p) => `${p.id} ${p.clienteNombre} ${p.numeroOrden ?? ""}`.toLowerCase().includes(texto)) : pedidos;
  const abiertos = visibles.filter((p) => p.estado !== "ENTREGADO" && p.estado !== "CANCELADO").map((p) => p.id);
  const [situacion, activos] = await Promise.all([situacionPedidos(abiertos), listarDespachosActivos(abiertos)]);
  const aArmar = vista === "armar" ? visibles.filter((p) => (situacion.get(p.id)?.pendienteConProducto ?? 0) > 0) : visibles;

  const url = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ estado: sp.estado, q: sp.q, archivados: sp.archivados, orden: sp.orden, vista: sp.vista, ...over })) if (v) q.set(k, v);
    return `/pedidos${q.toString() ? `?${q}` : ""}`;
  };
  const filas = vista === "armar" ? aArmar : visibles;

  return (
    <div className="space-y-5">
      <Suspense>
        {sp.creado && <Toast mensaje="Su pedido fue cargado con éxito" parametros={["creado"]} />}
        {sp.ok && <Toast mensaje={sp.ok} parametros={["ok"]} duracion={6000} />}
      </Suspense>
      <div className="encabezado mb-0">
        <div>
          <h1>Pedidos{sp.archivados === "1" ? " archivados" : ""}</h1>
          <p>Qué pidió cada cliente, para cuándo, y qué se puede armar o despachar.</p>
        </div>
        {puedeCrearPedido(usuario.rol) && (
          <Link href="/pedidos/nuevo" className="btn btn-primary">
            + Nuevo pedido
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FiltroTab href="/pedidos" activo={vista === "todos" && !estadoValido && sp.archivados !== "1"} label="Todos" />
        <FiltroTab href="/pedidos?vista=armar" activo={vista === "armar"} label="A armar" destacado />
        <FiltroTab href="/pedidos?estado=LISTO_PARA_DESPACHAR" activo={vista === "despachar"} label="Listos para despachar" n={conteos.LISTO_PARA_DESPACHAR} destacado />
        {FILTROS.filter((f) => f !== "LISTO_PARA_DESPACHAR").map((f) => (
          <FiltroTab key={f} href={`/pedidos?estado=${f}`} activo={estadoValido === f} label={ESTADO_LABEL[f]} n={conteos[f]} />
        ))}
        {ROLES_ESTRUCTURA.includes(usuario.rol) && <FiltroTab href="/pedidos?archivados=1" activo={sp.archivados === "1"} label="Archivados" />}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground-muted">Ordenar por:</span>
        {ORDENES.map((o) => (
          <Link key={o.id} href={url({ orden: o.id === "fecha" ? undefined : o.id })} className={`btn btn-sm ${orden === o.id ? "btn-azul" : "btn-outline"}`}>
            {o.label}
          </Link>
        ))}
        <form action="/pedidos" className="ml-auto">
          {sp.estado && <input type="hidden" name="estado" value={sp.estado} />}
          {sp.vista && <input type="hidden" name="vista" value={sp.vista} />}
          {sp.orden && <input type="hidden" name="orden" value={sp.orden} />}
          {sp.archivados === "1" && <input type="hidden" name="archivados" value="1" />}
          <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="Buscar cliente o N°…" className="input w-60" />
        </form>
      </div>

      {vista === "armar" && (
        <p className="aviso aviso-info text-sm">
          Pedidos con algo pendiente de armar. «Comenzar a armar pedido» se habilita cuando hay stock libre (sin contar lo ya asignado a otros pedidos
          por prioridad); si sólo alcanza para una parte, avisa lo que queda pendiente.
        </p>
      )}

      <div className="panel overflow-x-auto p-0">
        <table className="tabla">
          <thead>
            <tr>
              <th>N° · Cliente</th>
              <th>Ingreso</th>
              <th>Entrega</th>
              <th className="hidden xl:table-cell">Líneas</th>
              {verPrecios && <th className="hidden text-right xl:table-cell">Total</th>}
              <th>Estado</th>
              <th>{vista === "todos" ? "Situación" : "Acción"}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((p) => {
              const s = situacion.get(p.id);
              const activo = activos.get(p.id);
              const alerta = p.estado !== "ENTREGADO" && p.estado !== "CANCELADO" ? alertaEntrega(p.fechaEntregaPactada) : null;
              return (
                <tr key={p.id}>
                  <td>
                    <Link href={`/pedidos/${p.id}`} className="font-semibold text-foreground hover:text-accent">
                      {p.clienteNombre}
                    </Link>
                    <div className="text-xs text-foreground-muted">
                      #{p.id}
                      {p.numeroOrden && !p.numeroOrden.startsWith("IMPORT-") ? ` · N° ${p.numeroOrden}` : ""}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-foreground-muted">{fmtFecha(p.fechaPedido)}</td>
                  <td>
                    <div className="whitespace-nowrap text-foreground-muted">{p.fechaEntregaPactada ? fmtFecha(p.fechaEntregaPactada) : "—"}</div>
                    {(alerta || (p.prioridad !== 0 && p.estado !== "ENTREGADO" && p.estado !== "CANCELADO")) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {alerta && <span className={`badge-estado ${alerta.nivel === "semana" ? "badge-bajo" : "badge-critico"}`}>{alerta.texto}</span>}
                        {p.prioridad !== 0 && p.estado !== "ENTREGADO" && p.estado !== "CANCELADO" && <span className="badge-estado badge-naranja">{etiquetaPrioridad(p.prioridad)}</span>}
                      </div>
                    )}
                  </td>
                  <td className="hidden text-foreground-muted xl:table-cell">{p.lineas}</td>
                  {verPrecios && <td className="hidden text-right text-foreground-muted xl:table-cell">{fmtMoneda(p.total)}</td>}
                  <td>
                    <EstadoPedido estado={p.estado} />
                  </td>
                  <td>
                    {vista === "armar" && despacha ? (
                      activo ? (
                        <Link href={`/pedidos/${p.id}/despacho`} className="btn btn-azul btn-sm">
                          {activo === "ARMANDO" ? "Continuar armado" : "Despachar"}
                        </Link>
                      ) : (
                        <BotonPrepararDespacho pedidoId={p.id} chico {...disponibilidadArmado(s)} />
                      )
                    ) : vista === "despachar" && despacha ? (
                      activo === "CONTROLADO" ? (
                        <Link href={`/pedidos/${p.id}/despacho`} className="btn btn-primary btn-sm">
                          Despachar
                        </Link>
                      ) : (
                        <span className="text-xs text-foreground-muted">Estado importado sin armado: hay que armarlo primero.</span>
                      )
                    ) : (
                      <Situacion s={s} estado={p.estado} />
                    )}
                  </td>
                </tr>
              );
            })}
            {filas.length === 0 && (
              <tr>
                <td colSpan={verPrecios ? 7 : 6} className="py-8 text-center text-foreground-muted">
                  {vista === "armar" ? "No hay pedidos pendientes de armar." : vista === "despachar" ? "No hay pedidos listos para despachar." : "No hay pedidos en este estado."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground-muted">
        El material comprometido a entregar por producto está en <Link href="/catalogo#comprometido" className="text-accent hover:underline">Stock de productos</Link>.
      </p>
    </div>
  );
}

function FiltroTab({ href, activo, label, n, destacado }: { href: string; activo: boolean; label: string; n?: number; destacado?: boolean }) {
  return (
    <Link href={href} className={`btn btn-sm ${activo ? "btn-azul" : destacado ? "btn" : "btn-outline"}`}>
      {label}
      {n != null && <span className="ml-1 opacity-70">{n}</span>}
    </Link>
  );
}

/** Qué le falta a un pedido abierto para poder despacharse. */
function Situacion({ s, estado }: { s: SituacionPedido | undefined; estado: string }) {
  if (estado === "ENTREGADO" || estado === "CANCELADO") return <span className="text-xs text-foreground-muted">—</span>;
  if (!s || s.pendiente === 0) return <span className="text-xs text-foreground-muted">—</span>;
  if (s.despachoEnCurso && estado === "LISTO_PARA_DESPACHAR") return <span className="text-xs text-foreground-muted">Armado y controlado: falta despachar</span>;
  if (s.despachoEnCurso) return <span className="text-xs text-foreground-muted">En armado</span>;
  const partes: React.ReactNode[] = [];
  if (estado === "LISTO_PARA_DESPACHAR" || estado === "EN_ARMADO")
    partes.push(
      <span key="i" style={{ whiteSpace: "normal" }} className="badge-estado badge-bajo" title="Estado traído del Excel: no tiene armado ni control en el sistema">
        Estado importado sin armado
      </span>,
    );
  if (s.sinProducto > 0)
    partes.push(
      <span key="d" style={{ whiteSpace: "normal" }} className="badge-estado badge-exceso">
        Datos pendientes: {s.sinProducto} {s.sinProducto === 1 ? "renglón" : "renglones"} sin producto
      </span>,
    );
  if (s.faltaProducir > 0)
    partes.push(
      <span key="f" style={{ whiteSpace: "normal" }} className="badge-estado badge-critico">
        Falta producir {fmtNumero(s.faltaProducir, 0)}
      </span>,
    );
  if (partes.length === 0)
    partes.push(
      <span key="ok" style={{ whiteSpace: "normal" }} className="badge-estado badge-ok">
        Stock disponible para armar
      </span>,
    );
  return <div className="flex max-w-[15rem] flex-wrap gap-1">{partes}</div>;
}
