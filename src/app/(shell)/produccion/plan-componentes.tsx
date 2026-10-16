import Link from "next/link";
import { ArrowDown, ArrowUp, Factory } from "lucide-react";
import { FormAccion } from "@/components/form-accion";
import {
  actualizarTandaAction,
  cancelarTandaAction,
  crearTandaAction,
  iniciarTandaAction,
  moverTandaAction,
  postergarTandaAction,
  quitarPedidosAction,
} from "@/app/actions/planificacion";
import { TURNOS, etiquetaTurno, type AlertaEntrega, type GrupoPlanificacion, type TandaVista } from "@/lib/data/planificacion";
import { etiquetaPrioridad } from "@/lib/data/pedidos";
import { INYECTORAS } from "@/lib/inyectoras";
import { fmtFecha, fmtNumero } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";

export function BadgeAlerta({ a }: { a: AlertaEntrega }) {
  if (!a) return null;
  const clase = a.nivel === "semana" ? "badge-bajo" : "badge-critico";
  return <span className={`badge-estado ${clase}`}>{a.texto}</span>;
}

const ESTADO_TANDA: Record<TandaVista["estado"], { texto: string; clase: string }> = {
  PLANIFICADA: { texto: "Planificada", clase: "badge-info" },
  EN_CURSO: { texto: "En producción", clase: "badge-ok" },
  POSTERGADA: { texto: "Postergada", clase: "badge-bajo" },
  COMPLETADA: { texto: "Completada", clase: "badge-exceso" },
  CANCELADA: { texto: "Cancelada", clase: "badge-exceso" },
};

function Dato({ label, valor, fuerte }: { label: string; valor: React.ReactNode; fuerte?: boolean }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={fuerte ? "stat-valor" : "text-sm font-semibold"}>{valor}</span>
    </div>
  );
}

function CamposMaquina({ esAccesorio, inyectora, fecha, turno }: { esAccesorio: boolean; inyectora?: string | null; fecha?: string | null; turno?: string | null }) {
  return (
    <>
      <label className="campo w-40">
        <span>Inyectora</span>
        {esAccesorio ? (
          <select name="inyectora" defaultValue={inyectora ?? ""} className="input">
            <option value="">Sin asignar</option>
            {INYECTORAS.map((i) => (
              <option key={i} value={i}>
                Inyectora {i}
              </option>
            ))}
          </select>
        ) : (
          <input className="input" value="Inyectora 8 (baldosas)" readOnly />
        )}
      </label>
      <label className="campo w-40">
        <span>Fecha</span>
        <input type="date" name="fecha" defaultValue={fecha ?? ""} className="input" />
      </label>
      <label className="campo w-36">
        <span>Turno</span>
        <select name="turno" defaultValue={turno ?? ""} className="input">
          <option value="">Sin asignar</option>
          {TURNOS.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.etiqueta}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** Una tanda de la secuencia, con todo lo que la asignación tiene que dejar visible. */
export function TarjetaTanda({ t, posicion, total, golpesSugeridos, puedePlanificar }: { t: TandaVista; posicion: number; total: number; golpesSugeridos: number | null; puedePlanificar: boolean }) {
  const est = ESTADO_TANDA[t.estado];
  const editable = puedePlanificar && (t.estado === "PLANIFICADA" || t.estado === "POSTERGADA");
  return (
    <article className={`panel ${t.estado === "POSTERGADA" ? "opacity-75" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft font-[family-name:var(--font-display)] text-lg font-bold text-brand-azul">
            {posicion}
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-foreground">
              {t.colorNombre ?? "—"} · <span className="text-foreground-muted">{t.matriz}</span>
            </h3>
            <div className="text-xs text-foreground-muted">
              {t.codigo} · {t.descripcion}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className={`badge-estado ${est.clase}`}>{est.texto}</span>
              <BadgeAlerta a={t.alerta} />
              {t.usarArranque && <span className="badge-estado badge-naranja">Arranca con receta reforzada</span>}
            </div>
          </div>
        </div>
        {puedePlanificar && t.estado !== "EN_CURSO" && (
          <div className="flex gap-1">
            <form action={moverTandaAction}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="direccion" value="arriba" />
              <button className="btn btn-outline btn-sm" disabled={posicion === 1} aria-label="Producir antes" title="Producir antes">
                <ArrowUp size={15} />
              </button>
            </form>
            <form action={moverTandaAction}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="direccion" value="abajo" />
              <button className="btn btn-outline btn-sm" disabled={posicion === total} aria-label="Producir después" title="Producir después">
                <ArrowDown size={15} />
              </button>
            </form>
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
        <Dato label="Cantidad objetivo" valor={`${fmtNumero(t.objetivo, 0)} u.`} fuerte />
        <Dato label="Para pedidos / para stock" valor={`${fmtNumero(t.cantidadPedidos, 0)} / ${fmtNumero(t.cantidadStock, 0)}`} />
        <Dato label="Máquina y turno" valor={t.inyectora ? `Iny. ${t.inyectora} · ${etiquetaTurno(t.turno)}` : "Sin asignar"} />
        <Dato label="Fecha" valor={t.fecha ? fmtFecha(t.fecha) : "—"} />
        <Dato label={t.estado === "EN_CURSO" ? "Producido" : "Cargas de receta"} valor={t.estado === "EN_CURSO" ? `${fmtNumero(t.producido, 0)} de ${fmtNumero(t.objetivo, 0)}` : (t.cargas ?? "—")} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg bg-surface-muted p-3 text-sm">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-foreground-muted">Receta de carga</div>
          {t.receta ? (
            <ul className="space-y-0.5">
              {t.receta.items.map((i) => (
                <li key={`${i.materiaPrimaId}-${i.presentacionId}`}>
                  <b>{i.texto}</b> · {i.materiaPrimaNombre}
                </li>
              ))}
              {t.recetaArranque && <li className="text-xs text-foreground-muted">Arranque: {t.recetaArranque.items.map((i) => `${i.texto} ${i.materiaPrimaNombre}`).join(" + ")}</li>}
            </ul>
          ) : (
            <p className="text-foreground-muted">
              Sin receta. <Link href="/admin/recetas" className="text-accent hover:underline">Definirla →</Link>
            </p>
          )}
        </div>
        <div className="rounded-lg bg-surface-muted p-3 text-sm">
          <div className="mb-1 text-xs font-bold uppercase tracking-wide text-foreground-muted">Material requerido · disponible</div>
          {t.material.length ? (
            <ul className="space-y-0.5">
              {t.material.map((m) => (
                <li key={m.materiaPrimaId} className={m.faltanteKg > 0 ? "font-semibold text-[var(--estado-critico-fg)]" : ""}>
                  {m.nombre}: {fmtPeso(m.requeridoKg, { gramos: m.esMaster })} · hay {fmtPeso(m.disponibleKg, { gramos: m.esMaster })}
                  {m.faltanteKg > 0 && ` · faltan ${fmtPeso(m.faltanteKg, { gramos: m.esMaster })}`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-foreground-muted">Se calcula con la receta y el peso por pieza.</p>
          )}
        </div>
      </div>

      {t.avisos.length > 0 && (
        <ul className="mt-3 space-y-1">
          {t.avisos.map((a) => (
            <li key={a} className="aviso aviso-alerta py-1.5 text-xs">
              {a}
            </li>
          ))}
        </ul>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-brand-azul">
          Pedidos de la tanda ({t.pedidos.length || "sólo stock"})
        </summary>
        {t.pedidos.length > 0 ? (
          editable ? (
            <FormAccion accion={quitarPedidosAction} ocultos={{ id: t.id }} boton="Quitar los marcados (vuelven a planificar)" claseBoton="btn btn-outline btn-sm" className="mt-2 space-y-2">
              <ListaPedidos t={t} conCheck />
              <input name="motivo" placeholder="Motivo (ej. se entregan la semana próxima)" className="input" />
            </FormAccion>
          ) : (
            <div className="mt-2">
              <ListaPedidos t={t} />
            </div>
          )
        ) : (
          <p className="mt-2 text-foreground-muted">Producción para stock, sin pedidos asociados.</p>
        )}
      </details>

      <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-border pt-3">
        {t.estado === "EN_CURSO" && t.cicloId && (
          <Link href={`/produccion/${t.cicloId}`} className="btn btn-azul btn-sm">
            <Factory size={15} /> Ver la producción
          </Link>
        )}
        {puedePlanificar && t.estado === "PLANIFICADA" && (
          <details className="w-full sm:w-auto">
            <summary className="btn btn-primary btn-sm list-none">Iniciar producción</summary>
            <FormAccion accion={iniciarTandaAction} ocultos={{ id: t.id }} boton="Confirmar inicio" className="mt-2 flex flex-wrap items-end gap-2">
              <label className="campo w-48">
                <span>Golpes de la máquina al iniciar</span>
                <input name="golpesInicio" type="number" min={0} step={1} defaultValue={golpesSugeridos ?? ""} className="input" />
                <span className="campo-ayuda">{golpesSugeridos != null ? "Último registro de esta inyectora." : "Leerlo del contador de la máquina."}</span>
              </label>
            </FormAccion>
          </details>
        )}
        {editable && (
          <details className="w-full sm:w-auto">
            <summary className="btn btn-outline btn-sm list-none">Asignar máquina, turno y cantidades</summary>
            <FormAccion accion={actualizarTandaAction} ocultos={{ id: t.id }} boton="Guardar" className="mt-2 flex flex-wrap items-end gap-2">
              <CamposMaquina esAccesorio={t.esAccesorio} inyectora={t.inyectora} fecha={t.fecha} turno={t.turno} />
              <label className="campo w-36">
                <span>Extra para stock</span>
                <input name="cantidadStock" type="number" min={0} step={1} defaultValue={t.cantidadStock} className="input" />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="usarArranque" defaultChecked={t.usarArranque} disabled={!t.recetaArranque} /> Arrancar con receta reforzada
              </label>
              <label className="campo w-full">
                <span>Indicaciones para el operario (opcional)</span>
                <input name="observaciones" defaultValue={t.observaciones ?? ""} className="input" />
              </label>
            </FormAccion>
          </details>
        )}
        {editable && (
          <details className="w-full sm:w-auto">
            <summary className="btn btn-ghost btn-sm list-none">{t.estado === "POSTERGADA" ? "Reactivar" : "Postergar"}</summary>
            <FormAccion accion={postergarTandaAction} ocultos={{ id: t.id, reactivar: t.estado === "POSTERGADA" ? 1 : 0 }} boton={t.estado === "POSTERGADA" ? "Volver a la secuencia" : "Postergar"} claseBoton="btn btn-outline btn-sm" className="mt-2 flex flex-wrap items-end gap-2">
              {t.estado !== "POSTERGADA" && <input name="motivo" required placeholder="Motivo (ej. falta master, entrega la semana próxima)" className="input w-80" />}
            </FormAccion>
          </details>
        )}
        {editable && (
          <details className="w-full sm:w-auto">
            <summary className="btn btn-ghost btn-sm list-none">Cancelar tanda</summary>
            <FormAccion accion={cancelarTandaAction} ocultos={{ id: t.id }} boton="Cancelar la tanda" claseBoton="btn btn-outline btn-sm" confirmar="¿Cancelar la tanda? Sus pedidos vuelven a «Por planificar»." className="mt-2 flex flex-wrap items-end gap-2">
              <input name="motivo" placeholder="Motivo" className="input w-64" />
            </FormAccion>
          </details>
        )}
      </div>
    </article>
  );
}

function ListaPedidos({ t, conCheck }: { t: TandaVista; conCheck?: boolean }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {t.pedidos.map((p) => (
        <li key={p.pedidoLineaId} className="flex flex-wrap items-center gap-2 px-3 py-2">
          {conCheck && <input type="checkbox" name="quitar" value={p.pedidoLineaId} aria-label={`Quitar pedido ${p.pedidoId}`} />}
          <Link href={`/pedidos/${p.pedidoId}`} className="font-semibold text-accent hover:underline">
            #{p.pedidoId}
          </Link>
          <span>{p.clienteNombre}</span>
          <span className="text-foreground-muted">· {fmtNumero(p.cantidad, 0)} u.</span>
          <span className="text-xs text-foreground-muted">
            ingresó {fmtFecha(p.fechaPedido)}
            {p.fechaEntrega ? ` · entrega ${fmtFecha(p.fechaEntrega)}` : ""}
          </span>
          {p.prioridad !== 0 && <span className="badge-estado badge-naranja">{etiquetaPrioridad(p.prioridad)}</span>}
          <BadgeAlerta a={p.alerta} />
        </li>
      ))}
    </ul>
  );
}

/** Producto + color con pedidos sin planificar: arma la tanda en un paso. */
export function TarjetaGrupo({ g, tieneArranque, puedePlanificar }: { g: GrupoPlanificacion; tieneArranque: boolean; puedePlanificar: boolean }) {
  const pendientes = g.lineas.filter((l) => l.aPlanificar > 0);
  return (
    <article className="panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">
            {g.colorNombre ?? "—"} · <span className="text-foreground-muted">{g.matriz}</span>
          </h3>
          <div className="text-xs text-foreground-muted">
            {g.codigo} · {g.descripcion}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <BadgeAlerta a={g.alerta} />
            {!g.tieneReceta && <span className="badge-estado badge-bajo">Sin receta de carga</span>}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4 text-right">
          <Dato label="Pedido" valor={fmtNumero(g.pendiente, 0)} />
          <Dato label="En stock" valor={fmtNumero(g.stock, 0)} />
          <Dato label="Planificado" valor={fmtNumero(g.planificado, 0)} />
          <Dato label="Por planificar" valor={fmtNumero(g.aPlanificar, 0)} fuerte />
        </div>
      </div>
      {puedePlanificar && pendientes.length > 0 && (
        <details className="mt-3">
          <summary className="btn btn-primary btn-sm list-none">Planificar tanda</summary>
          <FormAccion accion={crearTandaAction} ocultos={{ productoId: g.productoId }} boton="Agregar a la secuencia" className="mt-3 space-y-3">
            <p className="text-xs text-foreground-muted">Destildá los pedidos que quieras dejar para una tanda posterior (para intercalar otros colores).</p>
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {pendientes.map((l) => (
                <li key={l.pedidoLineaId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <input type="checkbox" name="linea" value={l.pedidoLineaId} defaultChecked aria-label={`Incluir pedido ${l.pedidoId}`} />
                  <Link href={`/pedidos/${l.pedidoId}`} className="font-semibold text-accent hover:underline">
                    #{l.pedidoId}
                  </Link>
                  <span>{l.clienteNombre}</span>
                  <span className="text-xs text-foreground-muted">
                    ingresó {fmtFecha(l.fechaPedido)}
                    {l.fechaEntrega ? ` · entrega ${fmtFecha(l.fechaEntrega)}` : ""}
                  </span>
                  {l.prioridad !== 0 && <span className="badge-estado badge-naranja">{etiquetaPrioridad(l.prioridad)}</span>}
                  <BadgeAlerta a={l.alerta} />
                  <label className="ml-auto flex items-center gap-1.5 text-xs text-foreground-muted">
                    Cantidad
                    <input name={`cantidad_${l.pedidoLineaId}`} type="number" min={1} max={l.aPlanificar} step={1} defaultValue={l.aPlanificar} className="input w-24 py-1" />
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-end gap-2">
              <label className="campo w-36">
                <span>Extra para stock</span>
                <input name="cantidadStock" type="number" min={0} step={1} defaultValue={0} className="input" />
              </label>
              <CamposMaquina esAccesorio={g.esAccesorio} />
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name="usarArranque" disabled={!tieneArranque} /> Arrancar con receta reforzada
              </label>
            </div>
          </FormAccion>
        </details>
      )}
    </article>
  );
}

/** Tanda sólo para stock (sin pedido). */
export function FormStock({ productos }: { productos: { id: number; codigo: string; descripcion: string; esAccesorio: boolean }[] }) {
  return (
    <FormAccion accion={crearTandaAction} boton="Agregar a la secuencia" className="flex flex-wrap items-end gap-2">
      <label className="campo min-w-64 flex-1">
        <span>Producto y color</span>
        <select name="productoId" required defaultValue="" className="input">
          <option value="" disabled>
            Elegí el producto…
          </option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} · {p.descripcion}
            </option>
          ))}
        </select>
      </label>
      <label className="campo w-40">
        <span>Cantidad para stock</span>
        <input name="cantidadStock" type="number" min={1} step={1} required className="input" />
      </label>
    </FormAccion>
  );
}
