import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { obtenerPedido } from "@/lib/data/pedidos";
import { cajasDisponibles, listarDespachos, situacionLineas } from "@/lib/data/despachos";
import { getUsuarioActual } from "@/lib/session";
import { puedeOperarDespacho } from "@/lib/auth/permisos";
import { fmtFechaHora, fmtNumero } from "@/lib/format";
import { AnularDespacho, ConfirmarControl, Piqueo } from "./operacion";

export default async function DespachoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pedidoId = Number(id);
  const usuario = await getUsuarioActual();
  if (!puedeOperarDespacho(usuario.rol)) redirect(`/pedidos/${pedidoId}`);
  const pedido = await obtenerPedido(pedidoId);
  if (!pedido) notFound();
  const despachos = await listarDespachos(pedidoId);
  const d = despachos.find((x) => x.estado === "ARMANDO" || x.estado === "CONTROLADO");
  if (!d) redirect(`/pedidos/${pedidoId}`);

  const etapa = d.estado === "ARMANDO" ? "ARMADO" : "CONTROL_FINAL";
  const lineas = await situacionLineas(pedidoId);
  const validos = d.piqueos.filter((p) => !p.conAlerta);
  const porLinea = (tipo: "ARMADO" | "CONTROL_FINAL", codigo: string | null) =>
    validos.filter((p) => p.tipo === tipo && p.productoCodigo === codigo).reduce((s, p) => s + p.cantidad, 0);

  let sugerencias: { codigo: string; detalle: string }[] = [];
  if (etapa === "ARMADO") {
    const conPendiente = lineas.filter((l) => l.productoId != null && l.pendiente > 0).map((l) => l.productoId!);
    sugerencias = (await cajasDisponibles(conPendiente)).slice(0, 30).map((c) => ({
      codigo: c.codigo,
      detalle: `${c.disponible} disponibles · partida ${c.partidaNumero}`,
    }));
  } else {
    const vistos = new Set<string>();
    sugerencias = validos
      .filter((p) => p.tipo === "ARMADO")
      .filter((p) => (vistos.has(p.codigoLeido) ? false : (vistos.add(p.codigoLeido), true)))
      .map((p) => ({ codigo: p.codigoLeido, detalle: `${p.cantidad} armadas` }));
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/pedidos/${pedidoId}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← Pedido #{pedidoId}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">
          Despacho del pedido #{pedidoId} · {pedido.clienteNombre}
        </h1>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <Paso hecho={etapa === "CONTROL_FINAL"} actual={etapa === "ARMADO"} texto="1. Armado y primer control" />
          <Paso hecho={false} actual={etapa === "CONTROL_FINAL"} texto="2. Control final y entrega" />
        </div>
        {d.control1En && (
          <p className="mt-2 text-sm text-foreground-muted">
            Primer control: {d.control1PorNombre}, {fmtFechaHora(d.control1En)} — {d.control1Resultado}
          </p>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <th className="px-4 py-2.5">Producto</th>
              <th className="px-4 py-2.5 text-right">Pendiente del pedido</th>
              <th className="px-4 py-2.5 text-right">Armado</th>
              {etapa === "CONTROL_FINAL" && <th className="px-4 py-2.5 text-right">Controlado</th>}
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => {
              const armado = porLinea("ARMADO", l.productoCodigo);
              const controlado = porLinea("CONTROL_FINAL", l.productoCodigo);
              return (
                <tr key={l.lineaId} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5">
                    {l.productoCodigo ?? <span className="italic text-foreground-muted">sin producto (no se despacha)</span>}
                    {l.productoDescripcion && <span className="text-foreground-muted"> · {l.productoDescripcion}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">{fmtNumero(l.pedido - l.entregado, 0)}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{fmtNumero(armado, 0)}</td>
                  {etapa === "CONTROL_FINAL" && (
                    <td className={`px-4 py-2.5 text-right font-medium ${controlado === armado ? "text-[var(--estado-ok-fg)]" : ""}`}>
                      {fmtNumero(controlado, 0)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-surface p-4">
        <Piqueo key={etapa} pedidoId={pedidoId} despachoId={d.id} etapa={etapa} sugerencias={sugerencias} />
        <p className="mt-2 text-xs text-foreground-muted">
          Stock anterior a las cajas (sin partida): leé el código del producto e indicá la cantidad.
        </p>
      </div>

      <ConfirmarControl key={etapa} pedidoId={pedidoId} despachoId={d.id} etapa={etapa} />

      <section className="rounded-lg border border-border bg-surface p-4 text-sm">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-foreground-muted">Lecturas registradas</h2>
        {d.piqueos.length === 0 ? (
          <p className="text-foreground-muted">Todavía no hay lecturas.</p>
        ) : (
          <ul className="space-y-1">
            {d.piqueos.map((p) => (
              <li key={p.id} className={p.conAlerta ? "text-[var(--estado-bajo-fg)]" : ""}>
                <span className="font-mono">{p.codigoLeido}</span> · {p.tipo === "ARMADO" ? "armado" : "control final"} · {p.cantidad} u.
                {p.partidaNumero != null && ` · partida ${p.partidaNumero}`} · {p.usuarioNombre}, {fmtFechaHora(p.creadoEn)}
                {p.conAlerta && ` · ⚠ ${p.motivoAlerta} (no suma)`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <AnularDespacho pedidoId={pedidoId} despachoId={d.id} />
    </div>
  );
}

function Paso({ hecho, actual, texto }: { hecho: boolean; actual: boolean; texto: string }) {
  const clase = hecho ? "badge-ok" : actual ? "badge-bajo" : "bg-surface-muted text-foreground-muted";
  return <span className={`badge-estado ${clase}`}>{hecho ? "✓ " : ""}{texto}</span>;
}
