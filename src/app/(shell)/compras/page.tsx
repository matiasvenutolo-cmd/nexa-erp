import Link from "next/link";
import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { puedeGestionarCompras, puedeIngresarMateriaPrima, puedeVerCompras } from "@/lib/auth/permisos";
import { ABIERTAS, ESTADO_COMPRA_LABEL, listarCompras, type EstadoCompra, type FilaCompra } from "@/lib/data/compras";
import { listarProveedores, type Proveedor } from "@/lib/data/proveedores";
import { ESTADO_COMPRA_MP_LABEL, ORDEN_ESTADO_COMPRA_MP, situacionCompraMp } from "@/lib/data/necesidad-mp";
import { listarAuditoria } from "@/lib/data/auditoria";
import { FormAccion } from "@/components/form-accion";
import { actualizarCompraAction, ejecutarCompraAction, guardarProveedorAction } from "@/app/actions/compras";
import { fmtFecha, fmtFechaHora } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";
import { BADGE_COMPRA, CamposMonto, Cumplio, OPCIONES_ESTADO, SelectProveedor, aInput, fmtMonto } from "./componentes";
import { CamposProveedor } from "./proveedores/campos";

const VISTAS = [
  { id: "pedidos", label: "Pedidos para comprar" },
  { id: "estado", label: "Estado de compras" },
  { id: "proveedores", label: "Proveedores" },
] as const;
type Vista = (typeof VISTAS)[number]["id"];

const FILTROS: { id: string; label: string; estados?: EstadoCompra[] }[] = [
  { id: "curso", label: "En curso", estados: ABIERTAS },
  { id: "ejecutadas", label: "Ejecutadas", estados: ["ENTREGADA"] },
  { id: "canceladas", label: "Canceladas", estados: ["CANCELADA"] },
  { id: "todas", label: "Todas", estados: [...ABIERTAS, "ENTREGADA", "CANCELADA"] },
];

/**
 * Compras (pedido de NEXA, nov. 2026): ejecuta las compras que pide Materia
 * prima — no decide qué comprar —, eligiendo el proveedor y cargando los
 * montos, y sigue cada compra hasta que entra al depósito. La necesidad de
 * material la ve Materia prima en su tabla de stock.
 */
export default async function ComprasPage({ searchParams }: { searchParams: Promise<{ vista?: string; filtro?: string; proveedor?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeVerCompras(usuario.rol)) redirect("/tablero");
  const sp = await searchParams;
  const vista: Vista = VISTAS.some((v) => v.id === sp.vista) ? (sp.vista as Vista) : "pedidos";
  const gestiona = puedeGestionarCompras(usuario.rol);
  const [compras, proveedores] = await Promise.all([listarCompras(), listarProveedores()]);
  const pedidos = compras.filter((c) => c.estado === "SOLICITADA");
  const enCurso = compras.filter((c) => ABIERTAS.includes(c.estado));
  const problemas = enCurso.filter((c) => c.estado === "DEMORA" || c.estado === "FALTANTE" || c.atrasada);
  const activos = proveedores.filter((p) => p.activo);

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>Compras</h1>
          <p>Ejecuta las compras que pide Materia prima y sigue cada una hasta que entra al depósito.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="stat">
            <span className={`stat-valor ${pedidos.length ? "text-[var(--estado-bajo-fg)]" : ""}`}>{pedidos.length}</span>
            <span className="stat-label">pedidos para comprar</span>
          </div>
          <div className="stat">
            <span className="stat-valor">{enCurso.length}</span>
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
            href={v.id === "pedidos" ? "/compras" : `/compras?vista=${v.id}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${vista === v.id ? "border-accent text-brand-azul" : "border-transparent text-foreground-muted hover:text-foreground"}`}
          >
            {v.label}
            {v.id === "pedidos" && pedidos.length > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 text-xs text-white">{pedidos.length}</span>}
          </Link>
        ))}
      </nav>

      {vista === "pedidos" && <Pedidos pedidos={pedidos} proveedores={activos} gestiona={gestiona} />}
      {vista === "estado" && <Estado compras={compras} proveedores={proveedores} activos={activos} filtro={sp.filtro} proveedorId={Number(sp.proveedor) || null} gestiona={gestiona} ingresa={puedeIngresarMateriaPrima(usuario.rol)} />}
      {vista === "proveedores" && <Proveedores proveedores={proveedores} gestiona={gestiona} />}
    </div>
  );
}

async function Pedidos({ pedidos, proveedores, gestiona }: { pedidos: FilaCompra[]; proveedores: Proveedor[]; gestiona: boolean }) {
  if (pedidos.length === 0) return <p className="aviso aviso-info">No hay pedidos de Materia prima para ejecutar.</p>;
  const situacion = await situacionCompraMp();
  const orden = [...pedidos].sort((a, b) => ORDEN_ESTADO_COMPRA_MP[situacion.get(a.materiaPrimaId)?.estado ?? "OK"] - ORDEN_ESTADO_COMPRA_MP[situacion.get(b.materiaPrimaId)?.estado ?? "OK"] || a.id - b.id);
  return (
    <section className="space-y-3">
      {gestiona && proveedores.length === 0 && (
        <p className="aviso aviso-alerta text-sm">
          Para ejecutar una compra hace falta elegir el proveedor: cargalo primero en{" "}
          <Link href="/compras?vista=proveedores" className="font-semibold underline">
            Proveedores
          </Link>
          .
        </p>
      )}
      {orden.map((c) => {
        const s = situacion.get(c.materiaPrimaId);
        return (
          <article key={c.id} className="panel">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="text-base font-semibold">
                  {c.materiaPrimaNombre} · {fmtPeso(c.cantidadKg)}
                </div>
                <div className="text-sm text-foreground-muted">
                  Pedido #{c.id} · {fmtFecha(c.fechaPedido)} · {c.creadoPorNombre}
                  {c.observaciones ? ` · «${c.observaciones}»` : ""}
                </div>
              </div>
              {s && s.estado !== "OK" && <span className={`badge-estado ${s.estado === "URGENTE" ? "badge-critico" : "badge-bajo"}`}>{ESTADO_COMPRA_MP_LABEL[s.estado]}</span>}
            </div>
            {gestiona && (
              <div className="mt-3 grid gap-3 border-t border-border pt-3 lg:grid-cols-[1fr_auto]">
                <FormAccion accion={ejecutarCompraAction} ocultos={{ id: c.id }} boton="Ejecutar compra" className="grid gap-3 sm:grid-cols-3">
                  <label className="campo">
                    <span>Proveedor *</span>
                    <SelectProveedor proveedores={proveedores} />
                  </label>
                  <label className="campo">
                    <span>Cantidad (kg)</span>
                    <input name="cantidadKg" inputMode="decimal" defaultValue={aInput(c.cantidadKg)} className="input" />
                  </label>
                  <label className="campo">
                    <span>Estado</span>
                    <select name="estado" defaultValue="PEDIDO" className="input">
                      <option value="PEDIDO">{ESTADO_COMPRA_LABEL.PEDIDO}</option>
                      <option value="COMPRADO">{ESTADO_COMPRA_LABEL.COMPRADO}</option>
                    </select>
                  </label>
                  <CamposMonto />
                  <label className="campo">
                    <span>Entrega estimada</span>
                    <input name="fechaEntregaEstimada" type="date" className="input" />
                  </label>
                  <label className="campo">
                    <span>N° de orden de compra</span>
                    <input name="numeroOc" className="input" />
                  </label>
                  <p className="self-end text-xs text-foreground-muted">Cargá el precio por kg o el total: el otro se calcula con la cantidad.</p>
                </FormAccion>
                <FormAccion accion={actualizarCompraAction} ocultos={{ id: c.id, estado: "CANCELADA" }} boton="Descartar" claseBoton="btn btn-outline btn-sm" className="flex flex-col gap-2 self-end lg:w-48" confirmar="¿Descartar este pedido de Materia prima?">
                  <input name="motivo" required placeholder="Motivo del descarte" className="input" />
                </FormAccion>
              </div>
            )}
          </article>
        );
      })}
    </section>
  );
}

async function Estado({
  compras,
  proveedores,
  activos,
  filtro,
  proveedorId,
  gestiona,
  ingresa,
}: {
  compras: FilaCompra[];
  proveedores: Proveedor[];
  activos: Proveedor[];
  filtro?: string;
  proveedorId: number | null;
  gestiona: boolean;
  ingresa: boolean;
}) {
  const f = FILTROS.find((x) => x.id === filtro) ?? FILTROS[0];
  const visibles = compras.filter((c) => f.estados!.includes(c.estado) && (!proveedorId || c.proveedorId === proveedorId));
  const auditoria = visibles.length ? await listarAuditoria({ entidad: "compra_mp", entidadIds: visibles.map((c) => c.id), limite: 2000 }) : [];
  const href = (over: { filtro?: string; proveedor?: number | null }) => {
    const p = new URLSearchParams({ vista: "estado" });
    const fil = over.filtro ?? f.id;
    if (fil !== "curso") p.set("filtro", fil);
    const prov = over.proveedor === undefined ? proveedorId : over.proveedor;
    if (prov) p.set("proveedor", String(prov));
    return `/compras?${p}`;
  };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((x) => (
          <Link key={x.id} href={href({ filtro: x.id })} className={`btn btn-sm ${f.id === x.id ? "btn-azul" : "btn-outline"}`}>
            {x.label} <span className="opacity-70">{compras.filter((c) => x.estados!.includes(c.estado) && (!proveedorId || c.proveedorId === proveedorId)).length}</span>
          </Link>
        ))}
        <form action="/compras" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="vista" value="estado" />
          {f.id !== "curso" && <input type="hidden" name="filtro" value={f.id} />}
          <select name="proveedor" defaultValue={proveedorId ?? ""} className="input w-52">
            <option value="">Todos los proveedores</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
          <button className="btn btn-outline btn-sm">Filtrar</button>
        </form>
      </div>
      {visibles.length === 0 ? (
        <p className="aviso aviso-info">No hay compras para mostrar.</p>
      ) : (
        <ul className="space-y-2">
          {visibles.map((c) => (
            <li key={c.id} className="panel">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold">
                      #{c.id} · {c.materiaPrimaNombre}
                    </span>
                    <span className="text-sm text-foreground-muted">
                      {" "}
                      · {fmtPeso(c.cantidadKg)} · {c.proveedor ?? "sin proveedor"} · pedida {fmtFecha(c.fechaPedido)}
                      {c.fechaEntregaEstimada ? ` · entrega ${fmtFecha(c.fechaEntregaEstimada)}` : ""}
                      {c.montoTotal != null ? ` · ${fmtMonto(c.montoTotal, c.moneda)}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1">
                    {c.recibidoKg > 0 && c.estado !== "ENTREGADA" && <span className="text-xs text-foreground-muted">recibido {fmtPeso(c.recibidoKg)}</span>}
                    {c.atrasada && c.estado !== "DEMORA" && <span className="badge-estado badge-critico">entrega vencida</span>}
                    <span className={`badge-estado ${BADGE_COMPRA[c.estado]}`}>{ESTADO_COMPRA_LABEL[c.estado]}</span>
                  </span>
                </summary>
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2 text-sm">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                      <dt className="text-foreground-muted">Proveedor</dt>
                      <dd>{c.proveedorId ? <Link href={`/compras/proveedores/${c.proveedorId}`} className="font-semibold text-accent hover:underline">{c.proveedor}</Link> : (c.proveedor ?? "—")}</dd>
                      <dt className="text-foreground-muted">Precio por kg</dt>
                      <dd>{fmtMonto(c.precioKg, c.moneda)}</dd>
                      <dt className="text-foreground-muted">Total</dt>
                      <dd className="font-semibold">{fmtMonto(c.montoTotal, c.moneda)}</dd>
                      {c.numeroOc && (
                        <>
                          <dt className="text-foreground-muted">Orden de compra</dt>
                          <dd>{c.numeroOc}</dd>
                        </>
                      )}
                      <dt className="text-foreground-muted">Entrega</dt>
                      <dd>
                        <Cumplio c={c} />
                      </dd>
                    </dl>
                    {c.observaciones && <p>Observaciones: {c.observaciones}</p>}
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
                  {gestiona && ABIERTAS.includes(c.estado) && (
                    <FormAccion accion={actualizarCompraAction} boton="Guardar cambios" ocultos={{ id: c.id }} className="grid gap-2 sm:grid-cols-2">
                      <label className="campo">
                        <span>Estado</span>
                        <select name="estado" defaultValue={c.estado} className="input">
                          {OPCIONES_ESTADO.map((e) => (
                            <option key={e.valor} value={e.valor}>
                              {e.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="campo">
                        <span>Proveedor</span>
                        <SelectProveedor proveedores={activos.some((p) => p.id === c.proveedorId) ? activos : [...activos, ...proveedores.filter((p) => p.id === c.proveedorId)]} valor={c.proveedorId} requerido={false} />
                      </label>
                      <label className="campo">
                        <span>Cantidad (kg)</span>
                        <input name="cantidadKg" inputMode="decimal" defaultValue={aInput(c.cantidadKg)} className="input" />
                      </label>
                      <label className="campo">
                        <span>Entrega estimada</span>
                        <input name="fechaEntregaEstimada" type="date" defaultValue={c.fechaEntregaEstimada ?? ""} className="input" />
                      </label>
                      <CamposMonto precioKg={c.precioKg} montoTotal={c.montoTotal} moneda={c.moneda} />
                      <label className="campo">
                        <span>N° de orden de compra</span>
                        <input name="numeroOc" defaultValue={c.numeroOc ?? ""} className="input" />
                      </label>
                      <label className="campo sm:col-span-2">
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
      )}
    </section>
  );
}

function Proveedores({ proveedores, gestiona }: { proveedores: Awaited<ReturnType<typeof listarProveedores>>; gestiona: boolean }) {
  return (
    <section className="space-y-4">
      {gestiona && (
        <details className="panel" open={proveedores.length === 0}>
          <summary className="cursor-pointer font-semibold text-brand-azul">+ Cargar un proveedor</summary>
          <FormAccion accion={guardarProveedorAction} boton="Guardar proveedor" className="mt-3 grid gap-3 sm:grid-cols-3">
            <CamposProveedor />
          </FormAccion>
        </details>
      )}
      {proveedores.length === 0 ? (
        <p className="aviso aviso-info">Todavía no hay proveedores cargados.</p>
      ) : (
        <div className="panel overflow-x-auto p-0">
          <table className="tabla">
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Contacto</th>
                <th className="text-right">Compras</th>
                <th className="text-right">En curso</th>
                <th>Entregas a tiempo</th>
                <th className="text-right">Demora promedio</th>
                <th>Última compra</th>
              </tr>
            </thead>
            <tbody>
              {proveedores.map((p) => {
                const k = p.cumplimiento;
                const pct = k.medidas ? Math.round((k.aTiempo / k.medidas) * 100) : null;
                return (
                  <tr key={p.id} className={p.activo ? "" : "opacity-60"}>
                    <td>
                      <Link href={`/compras/proveedores/${p.id}`} className="font-semibold text-accent hover:underline">
                        {p.nombre}
                      </Link>
                      {!p.activo && <span className="badge-estado ml-2 bg-surface-muted text-foreground-muted">de baja</span>}
                    </td>
                    <td className="text-sm">{[p.contacto, p.telefono, p.email].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="text-right tabular-nums">{k.compras}</td>
                    <td className="text-right tabular-nums">
                      {k.enCurso}
                      {k.vencidas > 0 && <span className="badge-estado badge-critico ml-1">{k.vencidas} vencida{k.vencidas > 1 ? "s" : ""}</span>}
                    </td>
                    <td>{pct == null ? <span className="text-foreground-muted">sin entregas medidas</span> : <span className={`badge-estado ${pct >= 90 ? "badge-ok" : pct >= 70 ? "badge-bajo" : "badge-critico"}`}>{pct}% ({k.aTiempo} de {k.medidas})</span>}</td>
                    <td className="text-right tabular-nums">{k.demoraPromedio != null ? `${k.demoraPromedio} días` : "—"}</td>
                    <td>{k.ultimaCompra ? fmtFecha(k.ultimaCompra) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-foreground-muted">El cumplimiento compara la fecha de la última entrega de cada compra con su entrega estimada.</p>
    </section>
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
