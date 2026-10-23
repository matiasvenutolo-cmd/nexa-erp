import Link from "next/link";
import { Smartphone } from "lucide-react";
import { listarCiclos, productosParaCiclo } from "@/lib/data/produccion";
import { gruposParaPlanificar, listarTandas, necesidadDeCompra, ultimosGolpes, etiquetaTurno } from "@/lib/data/planificacion";
import { recetasDe } from "@/lib/data/recetas";
import { relevosRecientes, vistaTaller } from "@/lib/data/taller";
import { getUsuarioActual } from "@/lib/session";
import { puedeCargarProduccion, puedePlanificar, puedeAsignarTurnos } from "@/lib/auth/permisos";
import { fmtFecha, fmtFechaHora, fmtNumero } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";
import { etiquetaInyectora } from "@/lib/inyectoras";
import { FormStock, TarjetaGrupo, TarjetaTanda } from "./plan-componentes";
import { CalendarioPlan, type TarjetaCal, type TrabajoCal } from "./calendario";
import { listarIntervenciones, TIPO_INTERVENCION_LABEL } from "@/lib/data/matrices";
import { esquemasEntre } from "@/lib/data/turnos";
import { etiquetaPrioridad } from "@/lib/data/pedidos";
import { hoyISO, lunesDe, sumarDias } from "@/lib/format";
import { TurnosSemana } from "./turnos";
import { db } from "@/lib/db/client";
import { color as colorT } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";



async function Calendario({ tandas, planifica, desde }: { tandas: Awaited<ReturnType<typeof listarTandas>>; planifica: boolean; desde?: string }) {
  const inicio = lunesDe(desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : hoyISO());
  const dias = Array.from({ length: 7 }, (_, i) => sumarDias(inicio, i));
  const [intervenciones, esquemas] = await Promise.all([listarIntervenciones({ desde: dias[0], hasta: dias[6], estados: ["PROGRAMADA", "EN_CURSO"] }), esquemasEntre(dias[0], dias[6])]);
  const trabajos: TrabajoCal[] = intervenciones.map((w) => ({
    id: w.id,
    fecha: w.fechaProgramada,
    turno: w.turno,
    estado: w.estado,
    texto: `${TIPO_INTERVENCION_LABEL[w.tipo]} ${w.matrizAnterior ? `${w.matrizAnterior} → ` : ""}${w.matriz}${w.inyectora ? ` · iny. ${w.inyectora}` : ""}`,
  }));
  const colores = tandas.length ? await db.select({ id: colorT.id, hex: colorT.hex }).from(colorT).where(inArray(colorT.id, [...new Set(tandas.map((t) => t.colorId))])) : [];
  const tarjetas: TarjetaCal[] = tandas
    .filter((t) => !t.fecha || (t.fecha >= dias[0] && t.fecha <= dias[6]) || t.estado === "EN_CURSO")
    .map((t) => {
      const prio = Math.min(0, ...t.pedidos.map((p) => p.prioridad));
      return {
        id: t.id,
        fecha: t.fecha,
        turno: t.turno,
        estado: t.estado,
        color: t.colorNombre ?? "—",
        hex: colores.find((c) => c.id === t.colorId)?.hex ?? null,
        matriz: t.matriz,
        cantidad: t.objetivo,
        material: t.material.map((m) => `${m.nombre.replace(/^\S+[-\s]+/, "")} ${fmtPeso(m.requeridoKg, { gramos: m.esMaster && m.requeridoKg < 10 })}`).join(" · "),
        prioridad: prio < 0 ? etiquetaPrioridad(prio) : null,
        alerta: t.alerta && t.alerta.nivel !== "semana" ? t.alerta.texto : null,
        inyectora: t.inyectora,
        enCurso: t.estado === "EN_CURSO",
      };
    });
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-foreground-muted">
          Arrastrá cada tanda al día y turno en que se produce. El cambio se guarda al soltar. Las tandas en producción no se mueven.
        </p>
        <div className="flex gap-1">
          <Link href={`/produccion?vista=calendario&desde=${sumarDias(inicio, -7)}`} className="btn btn-outline btn-sm">
            ← Semana anterior
          </Link>
          <Link href="/produccion?vista=calendario" className="btn btn-outline btn-sm">
            Esta semana
          </Link>
          <Link href={`/produccion?vista=calendario&desde=${sumarDias(inicio, 7)}`} className="btn btn-outline btn-sm">
            Semana siguiente →
          </Link>
        </div>
      </div>
      <CalendarioPlan dias={dias} tarjetas={tarjetas} editable={planifica} trabajos={trabajos} esquemas={Object.fromEntries(esquemas)} />
    </section>
  );
}

const VISTAS = [
  { id: "plan", label: "Planificación" },
  { id: "calendario", label: "Calendario por turno" },
  { id: "turnos", label: "Turnos y operarios" },
  { id: "curso", label: "En curso" },
  { id: "relevos", label: "Relevos y novedades" },
  { id: "compras", label: "Compras" },
  { id: "historial", label: "Historial" },
] as const;
type Vista = (typeof VISTAS)[number]["id"];

/**
 * Producción — vista del Encargado (minuta 15/10/2026). La planificación es
 * la pantalla principal: qué falta producir agrupado por producto y color, la
 * secuencia de tandas con máquina, turno, receta y material, y desde ahí se
 * inicia cada producción. El resto (en curso, relevos, compras, historial) se
 * consulta en pestañas.
 */
export default async function ProduccionPage({ searchParams }: { searchParams: Promise<{ vista?: string; desde?: string }> }) {
  const sp = await searchParams;
  const vista: Vista = VISTAS.some((v) => v.id === sp.vista) ? (sp.vista as Vista) : "plan";
  const usuario = await getUsuarioActual();
  const planifica = puedePlanificar(usuario.rol);

  const [tandas, grupos] = await Promise.all([listarTandas(), gruposParaPlanificar()]);
  const enCurso = tandas.filter((t) => t.estado === "EN_CURSO").length;
  const alertas = grupos.filter((g) => g.alerta && g.alerta.nivel !== "semana").length + tandas.filter((t) => t.alerta && t.alerta.nivel !== "semana").length;
  const porPlanificar = grupos.reduce((t, g) => t + g.aPlanificar, 0);

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>Producción</h1>
          <p>Qué producir, en qué orden, en qué máquina y con qué receta.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="stat">
            <span className="stat-valor">{fmtNumero(porPlanificar, 0)}</span>
            <span className="stat-label">u. por planificar</span>
          </div>
          <div className="stat">
            <span className="stat-valor">{tandas.filter((t) => t.estado !== "EN_CURSO").length}</span>
            <span className="stat-label">tandas en secuencia</span>
          </div>
          <div className="stat">
            <span className="stat-valor">{enCurso}</span>
            <span className="stat-label">en producción</span>
          </div>
          <div className="stat">
            <span className={`stat-valor ${alertas ? "text-[var(--estado-critico-fg)]" : ""}`}>{alertas}</span>
            <span className="stat-label">entregas urgentes</span>
          </div>
        </div>
      </div>

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {VISTAS.map((v) => (
          <Link
            key={v.id}
            href={v.id === "plan" ? "/produccion" : `/produccion?vista=${v.id}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${vista === v.id ? "border-accent text-brand-azul" : "border-transparent text-foreground-muted hover:text-foreground"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {vista === "plan" && <Planificacion tandas={tandas} grupos={grupos} planifica={planifica} />}
      {vista === "calendario" && <Calendario tandas={tandas} planifica={planifica} desde={sp.desde} />}
      {vista === "turnos" && <TurnosSemana desde={sp.desde} edita={puedeAsignarTurnos(usuario.rol)} />}
      {vista === "curso" && <EnCurso />}
      {vista === "relevos" && <Relevos />}
      {vista === "compras" && <Compras tandas={tandas} />}
      {vista === "historial" && <Historial puedeIniciar={puedeCargarProduccion(usuario.rol)} />}
    </div>
  );
}

async function Planificacion({
  tandas,
  grupos,
  planifica,
}: {
  tandas: Awaited<ReturnType<typeof listarTandas>>;
  grupos: Awaited<ReturnType<typeof gruposParaPlanificar>>;
  planifica: boolean;
}) {
  const inyectoras = [...new Set(tandas.map((t) => t.inyectora).filter((x): x is string => Boolean(x)))];
  const golpes = new Map(await Promise.all(inyectoras.map(async (i) => [i, await ultimosGolpes(i)] as const)));
  const recetas = await recetasDe(grupos.map((g) => g.productoId));
  const conPlan = grupos.filter((g) => g.aPlanificar > 0);
  const productos = planifica ? await productosParaCiclo() : [];
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <section className="space-y-3">
        <h2 className="panel-titulo">Secuencia de producción</h2>
        {tandas.length === 0 ? (
          <p className="panel text-sm text-foreground-muted">
            No hay tandas planificadas. Armalas desde «Por planificar»: cada producto y color junta todos sus pedidos.
          </p>
        ) : (
          tandas.map((t, i) => (
            <TarjetaTanda key={t.id} t={t} posicion={i + 1} total={tandas.length} golpesSugeridos={t.inyectora ? (golpes.get(t.inyectora) ?? null) : null} puedePlanificar={planifica} />
          ))
        )}
      </section>
      <section className="space-y-3">
        <h2 className="panel-titulo">Por planificar · por producto y color</h2>
        {conPlan.length === 0 ? (
          <p className="panel text-sm text-foreground-muted">Todos los pedidos con faltante ya están en alguna tanda, o el stock alcanza.</p>
        ) : (
          conPlan.map((g) => <TarjetaGrupo key={g.productoId} g={g} tieneArranque={Boolean(recetas.get(g.productoId)?.ARRANQUE)} puedePlanificar={planifica} />)
        )}
        {planifica && (
          <div className="panel">
            <h3 className="panel-titulo">Producción para stock (sin pedido)</h3>
            <FormStock productos={productos} />
          </div>
        )}
      </section>
    </div>
  );
}

async function EnCurso() {
  const abiertos = (await listarCiclos(50)).filter((c) => !c.fechaFin);
  const vistas = await Promise.all(abiertos.map((c) => vistaTaller(c.inyectora)));
  if (abiertos.length === 0) return <p className="panel text-sm text-foreground-muted">No hay producciones en curso. Se inician desde la planificación.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {vistas.map((v) =>
        v.produccion ? (
          <article key={v.produccion.cicloId} className="panel space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold">
                  {etiquetaInyectora(v.inyectora)} · {v.produccion.colorNombre ?? "—"}
                </h3>
                <div className="text-xs text-foreground-muted">
                  {v.produccion.productoCodigo} · partida N° {v.produccion.partidaNumero ?? "—"}
                </div>
              </div>
              <span className={`badge-estado ${v.produccion.turnoAbierto ? "badge-ok" : "badge-bajo"}`}>
                {v.produccion.turnoAbierto ? `Turno ${etiquetaTurno(v.produccion.turnoAbierto.turno)} · ${v.produccion.turnoAbierto.operarioNombre ?? v.produccion.turnoAbierto.usuarioNombre}` : "Sin turno tomado"}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="stat">
                <span className="stat-label">Producido</span>
                <span className="stat-valor">{fmtNumero(v.produccion.producido, 0)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Objetivo</span>
                <span className="stat-valor">{v.produccion.objetivo != null ? fmtNumero(v.produccion.objetivo, 0) : "—"}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Falta</span>
                <span className="stat-valor">{v.produccion.falta != null ? fmtNumero(v.produccion.falta, 0) : "—"}</span>
              </div>
            </div>
            <div className="text-sm">
              <b>A pie de máquina:</b> {v.pie.length ? v.pie.map((m) => `${m.nombre} ${fmtPeso(m.kg, { gramos: m.esMaster })}`).join(" · ") : "nada"}
              <br />
              <b>En tolva:</b> {v.produccion.tolva.length ? v.produccion.tolva.map((m) => `${m.nombre} ${fmtPeso(m.kg, { gramos: m.esMaster })}`).join(" · ") : "nada"}
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/produccion/${v.produccion.cicloId}`} className="btn btn-azul btn-sm">
                Ver la producción
              </Link>
              <Link href={`/taller?iny=${v.inyectora}`} className="btn btn-outline btn-sm">
                <Smartphone size={15} /> Ver como el operario
              </Link>
            </div>
          </article>
        ) : null,
      )}
    </div>
  );
}

async function Relevos() {
  const { turnos, novedades, excepciones } = await relevosRecientes(40);
  return (
    <div className="space-y-6">
      <section className="panel overflow-x-auto p-0">
        <h2 className="panel-titulo mx-5 mt-4">Turnos (relevos)</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Inicio</th>
              <th>Máquina · turno</th>
              <th>Operario</th>
              <th>Producto</th>
              <th className="text-right">Golpes</th>
              <th className="text-right">Piezas</th>
              <th className="text-right">Descarte</th>
              <th>Recepción del relevo</th>
              <th>Interrupción</th>
            </tr>
          </thead>
          <tbody>
            {turnos.map(({ t, usuarioNombre, productoCodigo }) => (
              <tr key={t.id}>
                <td>{fmtFechaHora(t.inicio)}</td>
                <td>
                  Iny. {t.inyectora} · {etiquetaTurno(t.turno)}
                </td>
                <td>{t.operarioNombre ?? usuarioNombre}</td>
                <td>{productoCodigo ?? "—"}</td>
                <td className="text-right tabular-nums">
                  {t.golpesInicio ?? "—"} → {t.golpesFin ?? "en curso"}
                </td>
                <td className="text-right tabular-nums">{t.piezas ?? "—"}</td>
                <td className="text-right tabular-nums">{t.descarteKg != null ? `${fmtNumero(t.descarteKg, 3)} kg` : "—"}</td>
                <td>
                  {t.recepcionOk == null ? "—" : t.recepcionOk ? <span className="badge-estado badge-ok">Coincidía</span> : <span className="badge-estado badge-critico">Diferencia: {t.recepcionMotivo}</span>}
                </td>
                <td>{t.motivoInterrupcion ?? "—"}</td>
              </tr>
            ))}
            {turnos.length === 0 && (
              <tr>
                <td colSpan={9} className="text-foreground-muted">
                  Todavía no hay turnos registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="panel">
          <h2 className="panel-titulo">Novedades de máquina</h2>
          {novedades.length === 0 ? (
            <p className="text-sm text-foreground-muted">Sin novedades.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {novedades.map(({ n, usuarioNombre }) => (
                <li key={n.id} className="border-b border-border pb-2 last:border-0">
                  <span className="badge-estado badge-bajo mr-2">{TIPO_NOVEDAD[n.tipo]}</span>
                  <b>{n.motivo}</b> · Iny. {n.inyectora}
                  {n.detalle && <div className="text-xs text-foreground-muted">{n.detalle}</div>}
                  <div className="text-xs text-foreground-muted">
                    {fmtFechaHora(n.fecha)} · {usuarioNombre}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel">
          <h2 className="panel-titulo">Cargas distintas de la receta</h2>
          {excepciones.length === 0 ? (
            <p className="text-sm text-foreground-muted">Todas las cargas siguieron la receta.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {excepciones.map((e) => (
                <li key={e.id} className="border-b border-border pb-2 last:border-0">
                  <b>{e.mp}</b>: cargado {fmtNumero(e.cantidad, 3)} kg{e.planificado != null ? ` · receta ${fmtNumero(e.planificado, 3)} kg` : ""}
                  <div className="text-xs text-foreground-muted">
                    {e.motivo} · {fmtFechaHora(e.fecha)} · {e.usuarioNombre}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

const TIPO_NOVEDAD = { NO_CARGA: "No se cargó", CARGA_DISTINTA: "Carga distinta", DIFERENCIA_RELEVO: "Diferencia en el relevo", INTERRUPCION: "Interrupción" } as const;

async function Compras({ tandas }: { tandas: Awaited<ReturnType<typeof listarTandas>> }) {
  const nec = await necesidadDeCompra(tandas);
  return (
    <section className="panel overflow-x-auto p-0">
      <div className="px-5 pt-4">
        <h2 className="panel-titulo">Material para la planificación vs. disponible</h2>
        <p className="mb-3 text-sm text-foreground-muted">
          Calculado con la receta de cada tanda y el peso por pieza. Disponible = depósito + pie de máquina. Las tandas postergadas no cuentan.
          La necesidad completa (pedidos sin planificar, stock bajo el mínimo y compras en curso) está en{" "}
          <Link href="/compras" className="font-semibold text-accent underline">
            Compras
          </Link>
          .
        </p>
      </div>
      <table className="tabla">
        <thead>
          <tr>
            <th>Material</th>
            <th className="text-right">Requerido</th>
            <th className="text-right">Disponible</th>
            <th className="text-right">Falta comprar</th>
          </tr>
        </thead>
        <tbody>
          {nec.map((m) => (
            <tr key={m.materiaPrimaId}>
              <td className="font-semibold">{m.nombre}</td>
              <td className="text-right tabular-nums">{fmtPeso(m.requeridoKg, { gramos: m.esMaster && m.requeridoKg < 10 })}</td>
              <td className="text-right tabular-nums">{fmtPeso(m.disponibleKg, { gramos: m.esMaster && m.disponibleKg < 10 })}</td>
              <td className="text-right">
                {m.faltanteKg > 0 ? <span className="badge-estado badge-critico">{fmtPeso(m.faltanteKg, { gramos: m.esMaster && m.faltanteKg < 10 })}</span> : <span className="badge-estado badge-ok">Alcanza</span>}
              </td>
            </tr>
          ))}
          {nec.length === 0 && (
            <tr>
              <td colSpan={4} className="text-foreground-muted">
                No hay tandas con receta para calcular.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

async function Historial({ puedeIniciar }: { puedeIniciar: boolean }) {
  const ciclos = await listarCiclos(60);
  return (
    <section className="panel overflow-x-auto p-0">
      <div className="flex items-center justify-between px-5 pt-4">
        <h2 className="panel-titulo">Producciones</h2>
        {puedeIniciar && (
          <Link href="/produccion/nuevo" className="btn btn-outline btn-sm">
            Inicio de producción sin planificar
          </Link>
        )}
      </div>
      <table className="tabla">
        <thead>
          <tr>
            <th>Inicio</th>
            <th>Inyectora</th>
            <th>Producto</th>
            <th>Partida NEXA</th>
            <th className="text-right">Piezas producidas</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {ciclos.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/produccion/${c.id}`} className="font-semibold text-accent hover:underline">
                  {fmtFecha(c.fechaInicio)}
                </Link>
              </td>
              <td>{etiquetaInyectora(c.inyectora)}</td>
              <td>{c.productoCodigo ? `${c.productoCodigo} · ${c.productoDescripcion}` : "—"}</td>
              <td>{c.partidaNumero ?? "—"}</td>
              <td className="text-right tabular-nums">{c.piezasProducidas != null ? fmtNumero(c.piezasProducidas, 0) : "—"}</td>
              <td>{c.fechaFin ? <span className="badge-estado badge-exceso">Cerrada</span> : <span className="badge-estado badge-ok">En curso</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
