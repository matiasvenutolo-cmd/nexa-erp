import Link from "next/link";
import { listarPedidos, contarPedidosPorEstado, ESTADO_LABEL } from "@/lib/data/pedidos";
import { getUsuarioActual } from "@/lib/session";
import { puedeVerPrecios } from "@/lib/auth/permisos";
import { EstadoPedido } from "@/components/estado-pedido";
import { fmtFecha, fmtMoneda } from "@/lib/format";

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
  const verPrecios = puedeVerPrecios(usuario.rol);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand-azul-oscuro">Pedidos</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        <FiltroTab href="/pedidos" activo={!estadoValido} label="Todos" />
        {FILTROS.map((f) => (
          <FiltroTab key={f} href={`/pedidos?estado=${f}`} activo={estadoValido === f} label={ESTADO_LABEL[f]} n={conteos[f]} />
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <th className="px-4 py-2.5">Cliente</th>
              <th className="px-4 py-2.5">Fecha</th>
              <th className="px-4 py-2.5">Líneas</th>
              {verPrecios && <th className="px-4 py-2.5 text-right">Total</th>}
              <th className="px-4 py-2.5">Estado</th>
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
              </tr>
            ))}
            {pedidos.length === 0 && (
              <tr>
                <td colSpan={verPrecios ? 5 : 4} className="px-4 py-8 text-center text-foreground-muted">
                  No hay pedidos en este estado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
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
