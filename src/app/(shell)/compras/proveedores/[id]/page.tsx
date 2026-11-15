import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { puedeGestionarCompras, puedeVerCompras } from "@/lib/auth/permisos";
import { ESTADO_COMPRA_LABEL, listarCompras } from "@/lib/data/compras";
import { cumplimientoDe, proveedorPorId } from "@/lib/data/proveedores";
import { FormAccion } from "@/components/form-accion";
import { guardarProveedorAction } from "@/app/actions/compras";
import { fmtFecha } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";
import { BADGE_COMPRA, Cumplio, fmtMonto } from "../../componentes";
import { CamposProveedor } from "../campos";

/** Ficha del proveedor: datos, historial de compras y cumplimiento de entregas. */
export default async function ProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeVerCompras(usuario.rol)) redirect("/tablero");
  const { id } = await params;
  const p = await proveedorPorId(Number(id));
  if (!p) notFound();
  const compras = (await listarCompras({ proveedorId: p.id })).filter((c) => c.estado !== "SOLICITADA");
  const k = cumplimientoDe(compras);
  const pct = k.medidas ? Math.round((k.aTiempo / k.medidas) * 100) : null;
  const gestiona = puedeGestionarCompras(usuario.rol);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/compras?vista=proveedores" className="text-sm text-foreground-muted hover:text-foreground">
          ← Proveedores
        </Link>
        <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold text-brand-azul-oscuro">
          {p.nombre}
          {!p.activo && <span className="badge-estado bg-surface-muted text-foreground-muted">de baja</span>}
        </h1>
        <p className="text-sm text-foreground-muted">{[p.cuit && `CUIT ${p.cuit}`, p.contacto, p.telefono, p.email, p.condicionPago].filter(Boolean).join(" · ") || "Sin datos de contacto cargados."}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="panel">
          <div className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Compras</div>
          <div className="mt-1 text-2xl font-bold text-brand-azul">{k.compras}</div>
          <div className="text-xs text-foreground-muted">{k.enCurso} en curso · {k.entregadas} entregadas</div>
        </div>
        <div className="panel">
          <div className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Entregas a tiempo</div>
          <div className={`mt-1 text-2xl font-bold ${pct == null ? "text-foreground-muted" : pct >= 90 ? "text-[var(--estado-ok-fg)]" : pct >= 70 ? "text-[var(--estado-bajo-fg)]" : "text-[var(--estado-critico-fg)]"}`}>{pct == null ? "—" : `${pct}%`}</div>
          <div className="text-xs text-foreground-muted">{k.medidas ? `${k.aTiempo} de ${k.medidas} con fecha estimada` : "Todavía no hay entregas con fecha estimada"}</div>
        </div>
        <div className="panel">
          <div className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Demora promedio</div>
          <div className="mt-1 text-2xl font-bold text-brand-azul">{k.demoraPromedio != null ? `${k.demoraPromedio} días` : "—"}</div>
          <div className="text-xs text-foreground-muted">{k.vencidas ? `${k.vencidas} en curso con la fecha vencida` : "de las que llegaron tarde"}</div>
        </div>
        <div className="panel">
          <div className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Total comprado</div>
          <div className="mt-1 text-lg font-bold text-brand-azul">{k.montos.length ? k.montos.map((m) => fmtMonto(m.total, m.moneda)).join(" · ") : "—"}</div>
          <div className="text-xs text-foreground-muted">{k.ultimaCompra ? `última compra ${fmtFecha(k.ultimaCompra)}` : "sin compras"}</div>
        </div>
      </div>

      <section className="panel overflow-x-auto p-0">
        <h2 className="panel-titulo px-5 pt-4">Historial de compras</h2>
        {compras.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-foreground-muted">Todavía no tiene compras.</p>
        ) : (
          <table className="tabla">
            <thead>
              <tr>
                <th>Compra</th>
                <th>Material</th>
                <th className="text-right">Cantidad</th>
                <th>Pedida</th>
                <th>Entrega estimada</th>
                <th>Entregada</th>
                <th>Cumplimiento</th>
                <th className="text-right">Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {compras.map((c) => (
                <tr key={c.id}>
                  <td>#{c.id}</td>
                  <td>{c.materiaPrimaNombre}</td>
                  <td className="text-right tabular-nums">{fmtPeso(c.cantidadKg)}</td>
                  <td>{fmtFecha(c.fechaPedido)}</td>
                  <td>{c.fechaEntregaEstimada ? fmtFecha(c.fechaEntregaEstimada) : "—"}</td>
                  <td>{c.entregadaEl ? fmtFecha(c.entregadaEl) : "—"}</td>
                  <td>
                    <Cumplio c={c} />
                  </td>
                  <td className="whitespace-nowrap text-right tabular-nums">{fmtMonto(c.montoTotal, c.moneda)}</td>
                  <td>
                    <span className={`badge-estado ${BADGE_COMPRA[c.estado]}`}>{ESTADO_COMPRA_LABEL[c.estado]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {gestiona && (
        <details className="panel">
          <summary className="cursor-pointer font-semibold text-brand-azul">Editar la ficha</summary>
          <FormAccion accion={guardarProveedorAction} ocultos={{ id: p.id }} boton="Guardar ficha" className="mt-3 grid gap-3 sm:grid-cols-3">
            <CamposProveedor p={p} />
            <label className="flex items-center gap-2 self-end text-sm">
              <input type="checkbox" name="activo" value="1" defaultChecked={p.activo} />
              Activo (se puede elegir al ejecutar una compra)
            </label>
          </FormAccion>
        </details>
      )}
    </div>
  );
}
