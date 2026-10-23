import Link from "next/link";
import { obtenerTablero } from "@/lib/data/tablero";
import { getUsuarioActual } from "@/lib/session";
import { puedeVerProduccion, puedeVerVentas } from "@/lib/auth/permisos";
import { ESTADO_LABEL } from "@/lib/data/pedidos";
import { gruposParaPlanificar, listarTandas, necesidadDeCompra, etiquetaTurno } from "@/lib/data/planificacion";
import { relevosRecientes } from "@/lib/data/taller";
import { Semaforo } from "@/components/semaforo";
import { fmtFechaHora, fmtNumero } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";
import type { EstadoSemaforo } from "@/lib/data/stock";

const ESTADOS_PEDIDO = ["PEDIDO", "EN_ARMADO", "LISTO_PARA_DESPACHAR", "PARCIALMENTE_DESPACHADO"] as const;
const ESTADOS_SEMAFORO: EstadoSemaforo[] = ["critico", "bajo", "ok", "exceso"];

/**
 * Inicio. Para quien coordina o supervisa (minuta 15/10: "gerencia y
 * administración ven el estado de pedidos y producción, también de forma
 * remota; el encargado puede revisar desde su casa si se cumplió lo
 * planificado"): pedidos, producción en curso, entregas urgentes, novedades
 * de máquina y compras. Los indicadores gerenciales quedan para la última
 * etapa.
 */
export default async function TableroPage() {
  const usuario = await getUsuarioActual();
  const gestion = puedeVerVentas(usuario.rol);
  const fabrica = puedeVerProduccion(usuario.rol);
  const t = await obtenerTablero();
  const [tandas, grupos, compras, relevos] = fabrica || gestion
    ? await Promise.all([listarTandas(), gruposParaPlanificar(), necesidadDeCompra(), relevosRecientes(8)])
    : [[], [], [], { turnos: [], novedades: [], excepciones: [] }];
  const enCurso = tandas.filter((x) => x.estado === "EN_CURSO");
  const proximas = tandas.filter((x) => x.estado === "PLANIFICADA").slice(0, 5);
  const urgentes = [
    ...grupos.flatMap((g) => g.lineas.filter((l) => l.alerta && l.aPlanificar > 0).map((l) => ({ ...l, producto: `${g.colorNombre ?? ""} · ${g.matriz}`, planificada: false }))),
    ...tandas.flatMap((x) => x.pedidos.filter((p) => p.alerta).map((p) => ({ ...p, producto: `${x.colorNombre ?? ""} · ${x.matriz}`, planificada: true }))),
  ]
    .sort((a, b) => a.alerta!.dias - b.alerta!.dias)
    .slice(0, 8);
  const faltaComprar = compras.filter((c) => c.faltanteKg > 0);

  return (
    <div className="space-y-6">
      <div className="encabezado mb-0">
        <div>
          <h1>Inicio</h1>
          <p>Hola, {usuario.nombre.split(" ")[0]}. Así está la operación ahora.</p>
        </div>
      </div>

      <section>
        <h2 className="panel-titulo">Pedidos</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ESTADOS_PEDIDO.map((e) => (
            <Link key={e} href={`/pedidos?estado=${e}`} className="stat-card hover:bg-surface-muted">
              <div className="stat-valor">{t.pedidosPorEstado[e]}</div>
              <div className="stat-label">{ESTADO_LABEL[e]}</div>
            </Link>
          ))}
        </div>
      </section>

      {(fabrica || gestion) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel titulo="Producción en curso" verMas={fabrica ? "/produccion?vista=curso" : undefined}>
            {enCurso.length === 0 ? (
              <p className="text-sm text-foreground-muted">No hay producciones en curso.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {enCurso.map((x) => {
                  const pct = x.objetivo ? Math.min(100, Math.round((x.producido / x.objetivo) * 100)) : 0;
                  return (
                    <li key={x.id}>
                      <div className="flex justify-between gap-2">
                        <span className="font-semibold">
                          Iny. {x.inyectora} · {x.colorNombre} · {x.matriz}
                        </span>
                        <span className="text-foreground-muted">
                          {fmtNumero(x.producido, 0)} / {fmtNumero(x.objetivo, 0)}
                        </span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-muted">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {proximas.length > 0 && (
              <div className="mt-4 border-t border-border pt-3 text-sm">
                <div className="stat-label mb-1">Próximas en la secuencia</div>
                <ol className="space-y-1">
                  {proximas.map((x, i) => (
                    <li key={x.id} className="flex justify-between gap-2">
                      <span>
                        {i + 1}. {x.colorNombre} · {x.matriz}
                      </span>
                      <span className="text-foreground-muted">
                        {fmtNumero(x.objetivo, 0)} u.{x.inyectora ? ` · iny. ${x.inyectora}` : ""}
                        {x.turno ? ` · ${etiquetaTurno(x.turno)}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </Panel>

          <Panel titulo="Entregas comprometidas próximas" verMas={fabrica ? "/produccion" : "/pedidos"}>
            {urgentes.length === 0 ? (
              <p className="text-sm text-foreground-muted">No hay entregas en riesgo esta semana.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {urgentes.map((u) => (
                  <li key={`${u.pedidoLineaId}-${u.planificada}`} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      <Link href={`/pedidos/${u.pedidoId}`} className="font-semibold text-accent hover:underline">
                        #{u.pedidoId}
                      </Link>{" "}
                      {u.clienteNombre} · <span className="text-foreground-muted">{u.producto}</span>
                    </span>
                    <span className="flex gap-1">
                      <span className={`badge-estado ${u.alerta!.nivel === "semana" ? "badge-bajo" : "badge-critico"}`}>{u.alerta!.texto}</span>
                      <span className={`badge-estado ${u.planificada ? "badge-info" : "badge-exceso"}`}>{u.planificada ? "En la secuencia" : "Sin planificar"}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel titulo="Novedades de máquina y relevos" verMas={fabrica ? "/produccion?vista=relevos" : undefined}>
            {relevos.novedades.length === 0 && relevos.turnos.length === 0 ? (
              <p className="text-sm text-foreground-muted">Sin novedades.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {relevos.novedades.slice(0, 4).map(({ n, usuarioNombre }) => (
                  <li key={`n${n.id}`}>
                    <b>{n.motivo}</b> · Iny. {n.inyectora}
                    <div className="text-xs text-foreground-muted">
                      {fmtFechaHora(n.fecha)} · {usuarioNombre}
                    </div>
                  </li>
                ))}
                {relevos.turnos.slice(0, 3).map(({ t: tu, usuarioNombre, productoCodigo }) => (
                  <li key={`t${tu.id}`} className="text-foreground-muted">
                    Turno {etiquetaTurno(tu.turno)} iny. {tu.inyectora} · {tu.operarioNombre ?? usuarioNombre} · {productoCodigo ?? "—"} ·{" "}
                    {tu.estado === "ABIERTO" ? "en curso" : `${tu.piezas ?? 0} piezas`}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel titulo="Material que falta comprar" verMas={fabrica ? "/produccion?vista=compras" : undefined}>
            {faltaComprar.length === 0 ? (
              <p className="text-sm text-foreground-muted">El material alcanza para la planificación actual (con receta definida).</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {faltaComprar.slice(0, 6).map((c) => (
                  <li key={c.materiaPrimaId} className="flex justify-between gap-2">
                    <span>{c.nombre}</span>
                    <span className="font-semibold text-[var(--estado-critico-fg)]">faltan {fmtPeso(c.faltanteKg, { gramos: c.esMaster && c.faltanteKg < 10 })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {gestion && (
        <section>
          <h2 className="panel-titulo">Stock de productos</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ESTADOS_SEMAFORO.map((e) => (
              <Link key={e} href={e === "critico" || e === "bajo" ? "/catalogo?alertas=1" : "/catalogo"} className="stat-card hover:bg-surface-muted">
                <div className="stat-valor">{t.alertasPorEstado[e]}</div>
                <Semaforo estado={e} />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Panel({ titulo, verMas, children }: { titulo: string; verMas?: string; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="mb-3 flex items-baseline justify-between gap-2 border-b-2 border-[rgba(0,32,148,0.12)] pb-2">
        <h2 className="font-[family-name:var(--font-display)] text-[0.95rem] font-semibold text-brand-azul">{titulo}</h2>
        {verMas && (
          <Link href={verMas} className="text-xs font-semibold text-accent hover:underline">
            Ver más →
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
