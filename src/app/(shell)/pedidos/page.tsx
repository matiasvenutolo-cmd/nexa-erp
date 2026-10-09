import Link from "next/link";
import { listarPedidos, contarPedidosPorEstado, materialComprometido, situacionPedidos, ESTADO_LABEL, type SituacionPedido } from "@/lib/data/pedidos";
import { getUsuarioActual } from "@/lib/session";
import { puedeCrearPedido } from "@/lib/auth/permisos";
import { verPrecios as verPreciosDe } from "@/lib/vista";
import { EstadoPedido } from "@/components/estado-pedido";
import { fmtFecha, fmtMoneda, fmtNumero } from "@/lib/format";

// Estados que importan para el trabajo diario — Cancelado no se muestra acá
// por default (regla 7: no agregar lo que la tarea de hoy no necesita).
const FILTROS = ["PEDIDO", "EN_ARMADO", "LISTO_PARA_DESPACHAR", "PARCIALMENTE_DESPACHADO", "ENTREGADO"] as const;

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<{ estado?: string }>;
}) {
  const { estado } = await searchParams;
  const estadoValido = (FILTROS as readonly string[]).includes(estado ?? "")
    ? (estado as (typeof FILTROS)[number])
    : undefined;

  const [usuario, pedidos, conteos] = await Promise.all([
    getUsuarioActual(),
    listarPedidos(estadoValido),
    contarPedidosPorEstado(),
  ]);
  const verPrecios = await verPreciosDe(usuario);
  const gestion = puedeCrearPedido(usuario.rol);
  const comprometido = gestion ? await materialComprometido() : [];
  const situacion = await situacionPedidos(pedidos.filter((p) => p.estado !== "ENTREGADO" && p.estado !== "CANCELADO").map((p) => p.id));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand-azul-oscuro">Pedidos</h1>
        {puedeCrearPedido(usuario.rol) && (
          <Link
            href="/pedidos/nuevo"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            + Nuevo pedido
          </Link>
        )}
      </div>

      {gestion && comprometido.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-foreground">Material comprometido a entregar</h2>
            <span className="text-xs text-foreground-muted">
              {comprometido.length} productos · {comprometido.filter((c) => c.faltaProducir > 0).length} sin stock
              suficiente
            </span>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  <th className="py-1.5 pr-4">Producto</th>
                  <th className="py-1.5 pr-4 text-right">Comprometido</th>
                  <th className="py-1.5 pr-4 text-right">Stock</th>
                  <th className="py-1.5 text-right">Falta producir</th>
                </tr>
              </thead>
              <tbody>
                {comprometido.map((c) => (
                  <tr key={c.productoId} className="border-t border-border">
                    <td className="py-1.5 pr-4">
                      <span className="font-mono text-xs text-foreground-muted">{c.codigo}</span>{" "}
                      <span className="text-foreground">{c.descripcion}</span>
                    </td>
                    <td className="py-1.5 pr-4 text-right">{fmtNumero(c.comprometido, 0)}</td>
                    <td className="py-1.5 pr-4 text-right text-foreground-muted">{fmtNumero(c.stock, 0)}</td>
                    <td className="py-1.5 text-right">
                      {c.faltaProducir > 0 ? (
                        <span className="font-medium text-[var(--estado-critico-fg)]">
                          {fmtNumero(c.faltaProducir, 0)}
                        </span>
                      ) : (
                        <span className="text-foreground-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <FiltroTab href="/pedidos" activo={!estadoValido} label="Todos" />
        {FILTROS.map((f) => (
          <FiltroTab key={f} href={`/pedidos?estado=${f}`} activo={estadoValido === f} label={ESTADO_LABEL[f]} n={conteos[f]} />
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <th className="px-4 py-2.5">Cliente</th>
              <th className="px-4 py-2.5">Fecha</th>
              <th className="px-4 py-2.5">Líneas</th>
              {verPrecios && <th className="px-4 py-2.5 text-right">Total</th>}
              <th className="px-4 py-2.5">Estado</th>
              <th className="px-4 py-2.5">Situación</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0 hover:bg-surface-muted">
                <td className="px-4 py-3">
                  <Link href={`/pedidos/${p.id}`} className="font-medium text-foreground hover:text-accent">
                    {p.clienteNombre}
                  </Link>
                  {p.numeroOrden && !p.numeroOrden.startsWith("IMPORT-") && (
                    <span className="ml-2 text-xs text-foreground-muted">N° {p.numeroOrden}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-foreground-muted">{fmtFecha(p.fechaPedido)}</td>
                <td className="px-4 py-3 text-foreground-muted">{p.lineas}</td>
                {verPrecios && <td className="px-4 py-3 text-right text-foreground-muted">{fmtMoneda(p.total)}</td>}
                <td className="px-4 py-3">
                  <EstadoPedido estado={p.estado} />
                </td>
                <td className="px-4 py-3">
                  <Situacion s={situacion.get(p.id)} estado={p.estado} />
                </td>
              </tr>
            ))}
            {pedidos.length === 0 && (
              <tr>
                <td colSpan={verPrecios ? 6 : 5} className="px-4 py-8 text-center text-foreground-muted">
                  No hay pedidos en este estado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  );
}

function FiltroTab({ href, activo, label, n }: { href: string; activo: boolean; label: string; n?: number }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        activo ? "bg-accent text-accent-foreground" : "bg-surface-muted text-foreground-muted hover:text-foreground"
      }`}
    >
      {label}
      {n != null && <span className="ml-1.5 opacity-70">{n}</span>}
    </Link>
  );
}

/** Qué le falta a un pedido abierto para poder despacharse. */
function Situacion({ s, estado }: { s: SituacionPedido | undefined; estado: string }) {
  if (estado === "ENTREGADO" || estado === "CANCELADO") return <span className="text-xs text-foreground-muted">—</span>;
  if (!s || s.pendiente === 0) return <span className="text-xs text-foreground-muted">—</span>;
  if (s.despachoEnCurso && estado === "LISTO_PARA_DESPACHAR")
    return <span className="text-xs text-foreground-muted">Armado y controlado: falta el control final</span>;
  if (s.despachoEnCurso) return <span className="text-xs text-foreground-muted">En armado</span>;
  const partes: React.ReactNode[] = [];
  if (estado === "LISTO_PARA_DESPACHAR" || estado === "EN_ARMADO")
    partes.push(
      <span key="i" className="badge-estado badge-bajo" title="Estado traído del Excel: no tiene armado ni control en el sistema">
        Estado importado sin armado
      </span>,
    );
  if (s.sinProducto > 0)
    partes.push(
      <span key="d" className="badge-estado bg-surface-muted text-foreground-muted">
        Datos pendientes: {s.sinProducto} {s.sinProducto === 1 ? "renglón" : "renglones"} sin producto
      </span>,
    );
  if (s.faltaProducir > 0)
    partes.push(
      <span key="f" className="badge-estado badge-critico">
        Falta producir {fmtNumero(s.faltaProducir, 0)}
      </span>,
    );
  if (partes.length === 0)
    partes.push(
      <span key="ok" className="badge-estado badge-ok">
        Stock disponible para armar
      </span>,
    );
  return <div className="flex flex-wrap gap-1">{partes}</div>;
}
