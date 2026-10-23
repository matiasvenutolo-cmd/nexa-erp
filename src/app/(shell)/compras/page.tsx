import Link from "next/link";
import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { puedeGestionarCompras, puedeIngresarMateriaPrima, puedeVerCompras } from "@/lib/auth/permisos";
import { calcularNecesidad, ESTADO_COMPRA_LABEL, ESTADOS_COMPRA, listarCompras, type FilaCompra } from "@/lib/data/compras";
import { listarAuditoria } from "@/lib/data/auditoria";
import { materiasPrimasActivas } from "@/lib/data/materia-prima";
import { FormAccion } from "@/components/form-accion";
import { actualizarCompraAction, crearCompraAction } from "@/app/actions/compras";
import { fmtFecha, fmtFechaHora, hoyISO } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";

const VISTAS = [
  { id: "necesidad", label: "Necesidad de materia prima" },
  { id: "abiertas", label: "Compras en curso" },
  { id: "todas", label: "Todas las compras" },
] as const;

const BADGE: Record<FilaCompra["estado"], string> = {
  PEDIDO: "badge-info",
  COMPRADO: "badge-info",
  PARCIAL: "badge-bajo",
  DEMORA: "badge-critico",
  FALTANTE: "badge-critico",
  ENTREGADA: "badge-ok",
  CANCELADA: "bg-surface-muted text-foreground-muted",
};

/**
 * Compras de materia prima y master (perfil Compras): qué hace falta comprar
 * según la planificación, los pedidos, los mínimos y lo que ya se compró, y el
 * seguimiento de cada compra hasta que entra al depósito.
 */
export default async function ComprasPage({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeVerCompras(usuario.rol)) redirect("/tablero");
  const sp = await searchParams;
  const vista = VISTAS.some((v) => v.id === sp.vista) ? (sp.vista as (typeof VISTAS)[number]["id"]) : "necesidad";
  const gestiona = puedeGestionarCompras(usuario.rol);
  const ingresa = puedeIngresarMateriaPrima(usuario.rol);
  const [abiertas, materias] = await Promise.all([listarCompras({ abiertas: true }), materiasPrimasActivas()]);
  const problemas = abiertas.filter((c) => c.estado === "DEMORA" || c.estado === "FALTANTE" || c.atrasada);

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>Compras</h1>
          <p>Necesidad de materia prima y seguimiento de cada compra hasta que entra al depósito.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="stat">
            <span className="stat-valor">{abiertas.length}</span>
            <span className="stat-label">compras en curso</span>
          </div>
          <div className="stat">
            <span className={`stat-valor ${problemas.length ? "text-[var(--estado-critico-fg)]" : ""}`}>{problemas.length}</span>
            <span className="stat-label">con demora o faltante</span>
          </div>
        </div>
      </div>

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {VISTAS.map((v) => (
          <Link
            key={v.id}
            href={v.id === "necesidad" ? "/compras" : `/compras?vista=${v.id}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${vista === v.id ? "border-accent text-brand-azul" : "border-transparent text-foreground-muted hover:text-foreground"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {vista === "necesidad" && <Necesidad />}
      {vista !== "necesidad" && (
        <div className="space-y-4">
          {gestiona && (
            <details className="panel" open={abiertas.length === 0}>
              <summary className="cursor-pointer font-semibold text-brand-azul">Registrar una compra</summary>
              <FormAccion accion={crearCompraAction} boton="Registrar compra" className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="campo sm:col-span-2">
                  <span>Material *</span>
                  <select name="materiaPrimaId" required defaultValue="" className="input">
                    <option value="" disabled>
                      Elegí…
                    </option>
                    {materias
                      .filter((m) => m.tipo === "VIRGEN" || m.tipo === "MASTER")
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nombre}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="campo">
                  <span>Cantidad (kg) *</span>
                  <input name="cantidadKg" required inputMode="decimal" placeholder="Ej.: 1.500" className="input" />
                </label>
                <label className="campo">
                  <span>Proveedor</span>
                  <input name="proveedor" className="input" />
                </label>
                <label className="campo">
                  <span>Fecha del pedido *</span>
                  <input name="fechaPedido" type="date" required defaultValue={hoyISO()} className="input" />
                </label>
                <label className="campo">
                  <span>Entrega estimada</span>
                  <input name="fechaEntregaEstimada" type="date" className="input" />
                </label>
                <label className="campo">
                  <span>N° de orden de compra</span>
                  <input name="numeroOc" className="input" />
                </label>
                <label className="campo">
                  <span>Estado</span>
                  <select name="estado" defaultValue="PEDIDO" className="input">
                    <option value="PEDIDO">{ESTADO_COMPRA_LABEL.PEDIDO}</option>
                    <option value="COMPRADO">{ESTADO_COMPRA_LABEL.COMPRADO}</option>
                  </select>
                </label>
                <label className="campo">
                  <span>Observaciones</span>
                  <input name="observaciones" className="input" />
                </label>
              </FormAccion>
            </details>
          )}
          <ListaCompras compras={vista === "abiertas" ? abiertas : await listarCompras()} gestiona={gestiona} ingresa={ingresa} />
        </div>
      )}
    </div>
  );
}

async function ListaCompras({ compras, gestiona, ingresa }: { compras: FilaCompra[]; gestiona: boolean; ingresa: boolean }) {
  if (compras.length === 0) return <p className="aviso aviso-info">No hay compras para mostrar.</p>;
  // El historial de todas las compras en una sola consulta (no una por compra).
  const auditoria = await listarAuditoria({ entidad: "compra_mp", entidadIds: compras.map((c) => c.id), limite: 2000 });
  return (
    <ul className="space-y-2">
      {compras.map((c) => (
        <li key={c.id} className="panel">
          <details>
            <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
              <span>
                <span className="font-semibold">
                  #{c.id} · {c.materiaPrimaNombre}
                </span>
                <span className="text-sm text-foreground-muted">
                  {" "}
                  · {fmtPeso(c.cantidadKg)}
                  {c.proveedor ? ` · ${c.proveedor}` : ""} · pedida {fmtFecha(c.fechaPedido)}
                  {c.fechaEntregaEstimada ? ` · entrega ${fmtFecha(c.fechaEntregaEstimada)}` : ""}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1">
                {c.recibidoKg > 0 && <span className="text-xs text-foreground-muted">recibido {fmtPeso(c.recibidoKg)}</span>}
                {c.atrasada && c.estado !== "DEMORA" && <span className="badge-estado badge-critico">entrega vencida</span>}
                <span className={`badge-estado ${BADGE[c.estado]}`}>{ESTADO_COMPRA_LABEL[c.estado]}</span>
              </span>
            </summary>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div className="space-y-2 text-sm">
                {c.numeroOc && <p>Orden de compra: {c.numeroOc}</p>}
                {c.observaciones && <p>Observaciones: {c.observaciones}</p>}
                <p className="text-foreground-muted">Registrada por {c.creadoPorNombre}.</p>
                <div>
                  <div className="font-semibold">Entregas</div>
                  {c.entregas.length === 0 ? (
                    <p className="text-foreground-muted">Todavía no llegó nada. Las entregas se registran con el ingreso de proveedor en Materia prima.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {c.entregas.map((e) => (
                        <li key={e.id}>
                          {fmtFechaHora(e.fecha)} · {fmtPeso(e.kg)} · {e.usuarioNombre}
                        </li>
                      ))}
                    </ul>
                  )}
                  {c.pendienteKg > 0 && <p className="mt-1">Pendiente de entrega: {fmtPeso(c.pendienteKg)}</p>}
                  {ingresa && c.pendienteKg > 0 && (
                    <Link href={`/materia-prima/ingreso?compra=${c.id}`} className="btn btn-outline btn-sm mt-2">
                      Registrar ingreso de esta compra
                    </Link>
                  )}
                </div>
                <Historial filas={auditoria.filter((a) => a.entidadId === String(c.id)).slice(0, 30)} />
              </div>
              {gestiona && c.estado !== "ENTREGADA" && c.estado !== "CANCELADA" && (
                <FormAccion accion={actualizarCompraAction} boton="Guardar cambios" ocultos={{ id: c.id }} className="grid gap-2 sm:grid-cols-2">
                  <label className="campo">
                    <span>Estado</span>
                    <select name="estado" defaultValue={c.estado} className="input">
                      {ESTADOS_COMPRA.map((e) => (
                        <option key={e} value={e}>
                          {ESTADO_COMPRA_LABEL[e]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="campo">
                    <span>Entrega estimada</span>
                    <input name="fechaEntregaEstimada" type="date" defaultValue={c.fechaEntregaEstimada ?? ""} className="input" />
                  </label>
                  <label className="campo">
                    <span>Proveedor</span>
                    <input name="proveedor" defaultValue={c.proveedor ?? ""} className="input" />
                  </label>
                  <label className="campo">
                    <span>N° de orden de compra</span>
                    <input name="numeroOc" defaultValue={c.numeroOc ?? ""} className="input" />
                  </label>
                  <label className="campo">
                    <span>Cantidad (kg)</span>
                    <input name="cantidadKg" inputMode="decimal" defaultValue={String(c.cantidadKg).replace(".", ",")} className="input" />
                  </label>
                  <label className="campo">
                    <span>Observaciones</span>
                    <input name="observaciones" defaultValue={c.observaciones ?? ""} className="input" />
                  </label>
                  <label className="campo sm:col-span-2">
                    <span>Motivo del cambio (queda en el historial)</span>
                    <input name="motivo" className="input" />
                  </label>
                </FormAccion>
              )}
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Historial({ filas }: { filas: Awaited<ReturnType<typeof listarAuditoria>> }) {
  if (filas.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-semibold">Historial de cambios ({filas.length})</summary>
      <ul className="mt-1 space-y-0.5 text-foreground-muted">
        {filas.map((f) => (
          <li key={f.id}>
            {fmtFechaHora(f.creadoEn)} · {f.usuarioNombre} · {f.campo}: {f.valorAnterior ?? "—"} → {f.valorNuevo ?? "—"}
            {f.motivo ? ` (${f.motivo})` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

async function Necesidad() {
  const n = await calcularNecesidad();
  const conNecesidad = n.filas.filter((f) => f.necesidadKg > 0 || f.proyectadaKg > 0);
  return (
    <section className="space-y-4">
      <div className="aviso aviso-info text-sm">
        <b>Cómo se calcula:</b> material para los pedidos a producir (planificados y por planificar) + material para reponer el stock de pisos que
        está bajo el mínimo + mínimo de la propia materia prima − stock disponible (depósito y pie de máquina) = <b>necesidad</b>. Restando lo ya
        comprado y pendiente de entrega queda la <b>necesidad proyectada</b>. Las piezas se convierten a kilos con la receta y el peso por pieza.
      </div>
      {n.avisos.map((a) => (
        <p key={a} className="aviso aviso-alerta text-sm">
          {a}
        </p>
      ))}
      <div className="panel overflow-x-auto p-0">
        <table className="tabla">
          <thead>
            <tr>
              <th>Material</th>
              <th className="text-right">Pedidos</th>
              <th className="text-right">Stock de pisos bajo mínimo</th>
              <th className="text-right">Mínimo de MP</th>
              <th className="text-right">Disponible</th>
              <th className="text-right">Necesidad</th>
              <th className="text-right">Comprado pendiente</th>
              <th className="text-right">Proyectada</th>
            </tr>
          </thead>
          <tbody>
            {n.filas.map((f) => {
              const g = {};
              return (
                <tr key={f.materiaPrimaId}>
                  <td>
                    <div className="font-semibold">{f.nombre}</div>
                    {f.estimado && <span className="badge-estado badge-bajo mr-1">estimado</span>}
                    {f.riesgo && <div className="text-xs font-semibold text-[var(--estado-critico-fg)]">{f.riesgo}</div>}
                  </td>
                  <td className="text-right">{f.pedidosKg ? fmtPeso(f.pedidosKg, g) : "—"}</td>
                  <td className="text-right">{f.stockProductoKg ? fmtPeso(f.stockProductoKg, g) : "—"}</td>
                  <td className="text-right">{f.objetivoMpKg ? fmtPeso(f.objetivoMpKg, g) : "—"}</td>
                  <td className="text-right">{fmtPeso(f.disponibleKg, g)}</td>
                  <td className={`text-right font-semibold ${f.necesidadKg > 0 ? "text-[var(--estado-bajo-fg)]" : ""}`}>{f.necesidadKg ? fmtPeso(f.necesidadKg, g) : "—"}</td>
                  <td className="text-right">{f.compradoPendienteKg ? fmtPeso(f.compradoPendienteKg, g) : "—"}</td>
                  <td className={`text-right font-bold ${f.proyectadaKg > 0 ? "text-[var(--estado-critico-fg)]" : "text-[var(--estado-ok-fg)]"}`}>
                    {f.proyectadaKg > 0 ? fmtPeso(f.proyectadaKg, g) : "cubierto"}
                  </td>
                </tr>
              );
            })}
            {n.filas.length === 0 && (
              <tr>
                <td colSpan={8} className="text-foreground-muted">
                  No hay demanda ni mínimos cargados que generen necesidad.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-foreground-muted">
        {conNecesidad.length
          ? `${conNecesidad.length} materiales con necesidad.`
          : "Con lo planificado, los pedidos y los mínimos cargados, el material alcanza."}
      </p>
      {n.sinConfigurar.length > 0 && (
        <div className="panel">
          <h2 className="panel-titulo">No se pudieron calcular (falta configurar)</h2>
          <p className="mb-2 text-sm text-foreground-muted">
            Estos productos tienen demanda pero les falta la receta de carga o el peso por pieza: no se suman a la necesidad hasta configurarlos
            (Configuración → Recetas de carga / Productos).
          </p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {n.sinConfigurar.slice(0, 40).map((s) => (
              <li key={`${s.codigo}-${s.motivo}`}>
                <span className="font-mono text-xs">{s.codigo}</span> · {s.unidades} u. · {s.motivo}
              </li>
            ))}
          </ul>
          {n.sinConfigurar.length > 40 && <p className="mt-1 text-xs text-foreground-muted">y {n.sinConfigurar.length - 40} más.</p>}
        </div>
      )}
    </section>
  );
}
