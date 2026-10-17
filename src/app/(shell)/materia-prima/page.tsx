import Link from "next/link";
import { redirect } from "next/navigation";
import { pieDeMaquina } from "@/lib/data/maquina";
import { fraccionamientosRecientes, movimientosMp, stockMpPorUbicacion, MOTIVOS_AJUSTE_MP } from "@/lib/data/stock-mp";
import { listarPresentaciones, presentacionesDe } from "@/lib/data/recetas";
import { enBolsas, relevosRecientes } from "@/lib/data/taller";
import { getUsuarioActual } from "@/lib/session";
import {
  puedeAjustarMateriaPrima,
  puedeAltaMateriaPrima,
  puedeCorregirProduccionMp,
  puedeIngresarMateriaPrima,
  puedeRetirarMateriaPrima,
  puedeVerMateriaPrima,
} from "@/lib/auth/permisos";
import { Semaforo } from "@/components/semaforo";
import { FormAccion } from "@/components/form-accion";
import { ajusteMpAction, altaMpAction, bolsonAction, fraccionarAction } from "@/app/actions/materia-prima";
import { fmtDia, fmtFechaHora, fmtHora, fmtNumero, hoyISO } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";
import { etiquetaInyectora } from "@/lib/inyectoras";

const VISTAS = [
  { id: "stock", label: "Stock general" },
  { id: "pie", label: "Stock a pie de máquina" },
  { id: "movimientos", label: "Movimientos" },
  { id: "operaciones", label: "Operaciones de stock" },
] as const;
type Vista = (typeof VISTAS)[number]["id"];

const TIPOS = [
  { valor: undefined, label: "Todos" },
  { valor: "VIRGEN", label: "Materia prima" },
  { valor: "MASTER", label: "Master" },
  { valor: "MOLIENDA", label: "Molienda" },
  { valor: "SOBRANTE", label: "Sobrante" },
];

/**
 * Materia prima (minuta 15/10/2026): la vista de Materia prima, centrada en el
 * stock — depósito, pie de máquina y tolva por separado —, los ingresos y
 * egresos día por día, lotes y certificados, y las variantes (diferencia de
 * balanza, molienda, fraccionamiento, alta de materiales). Sin pedidos ni la
 * pantalla operativa de producción.
 */
export default async function MateriaPrimaPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tipo?: string; texto?: string; alertas?: string; desde?: string; hasta?: string; mp?: string; ubic?: string }>;
}) {
  const usuario = await getUsuarioActual();
  if (!puedeVerMateriaPrima(usuario.rol)) redirect("/tablero");
  const sp = await searchParams;
  const vista: Vista = VISTAS.some((v) => v.id === sp.vista) ? (sp.vista as Vista) : "stock";
  const stock = await stockMpPorUbicacion();

  return (
    <div>
      <div className="encabezado">
        <div>
          <h1>Materia prima</h1>
          <p>Dos depósitos: el stock general (Materia prima) y el stock a pie de máquina (junto a cada inyectora). La tolva es lo ya cargado en la máquina.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {puedeIngresarMateriaPrima(usuario.rol) && (
            <Link href="/materia-prima/ingreso" className="btn btn-primary">
              + Ingreso de proveedor
            </Link>
          )}
          {puedeRetirarMateriaPrima(usuario.rol) && (
            <Link href="/materia-prima/retiro" className="btn btn-outline">
              Retiro a pie de máquina
            </Link>
          )}
        </div>
      </div>

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {VISTAS.map((v) => (
          <Link
            key={v.id}
            href={v.id === "stock" ? "/materia-prima" : `/materia-prima?vista=${v.id}`}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${vista === v.id ? "border-accent text-brand-azul" : "border-transparent text-foreground-muted hover:text-foreground"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {vista === "stock" && <Stock stock={stock} sp={sp} />}
      {vista === "movimientos" && <Movimientos stock={stock} sp={sp} />}
      {vista === "pie" && <Pie />}
      {vista === "operaciones" && <Ajustes stock={stock} ajusta={puedeAjustarMateriaPrima(usuario.rol)} alta={puedeAltaMateriaPrima(usuario.rol)} corrige={puedeCorregirProduccionMp(usuario.rol)} />}
    </div>
  );
}

type Stock = Awaited<ReturnType<typeof stockMpPorUbicacion>>;

async function Stock({ stock, sp }: { stock: Stock; sp: { tipo?: string; texto?: string; alertas?: string } }) {
  const movs = await movimientosMp({ ubicacion: "deposito", limite: 15 });
  const tipo = TIPOS.some((t) => t.valor === sp.tipo) ? sp.tipo : undefined;
  const texto = sp.texto?.trim().toLowerCase();
  const soloAlertas = sp.alertas === "1";
  const visibles = stock.filter(
    (m) => (!tipo || m.tipo === tipo) && (!texto || `${m.codigo} ${m.nombre}`.toLowerCase().includes(texto)) && (!soloAlertas || m.estado === "critico" || m.estado === "bajo"),
  );
  const q = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tipo: sp.tipo, texto: sp.texto, alertas: sp.alertas, ...over })) if (v) p.set(k, v);
    return `/materia-prima${p.toString() ? `?${p}` : ""}`;
  };
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {TIPOS.map((t) => (
          <Link key={t.label} href={q({ tipo: t.valor })} className={`btn btn-sm ${tipo === t.valor ? "btn-azul" : "btn-outline"}`}>
            {t.label}
          </Link>
        ))}
        <Link href={q({ alertas: soloAlertas ? undefined : "1" })} className={`btn btn-sm ${soloAlertas ? "btn-azul" : "btn-outline"}`}>
          Sólo bajo el mínimo
        </Link>
        <form action="/materia-prima" className="ml-auto">
          {tipo && <input type="hidden" name="tipo" value={tipo} />}
          {soloAlertas && <input type="hidden" name="alertas" value="1" />}
          <input type="search" name="texto" defaultValue={sp.texto ?? ""} placeholder="Buscar material…" className="input w-56" />
        </form>
      </div>
      <div className="panel overflow-x-auto p-0">
        <table className="tabla">
          <thead>
            <tr>
              <th>Código</th>
              <th>Material</th>
              <th className="text-right">Stock general</th>
              <th className="text-right">Mínimo</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((m) => {
              const g = m.tipo === "MASTER";
              return (
                <tr key={m.id}>
                  <td className="font-mono text-xs">{m.codigo}</td>
                  <td>
                    <Link href={`/materia-prima/${m.id}`} className="font-semibold text-accent hover:underline">
                      {m.nombre}
                    </Link>
                    {m.pie > 0 && <div className="text-xs text-foreground-muted">+ {fmtPeso(m.pie, { gramos: g && m.pie < 10 })} a pie de máquina</div>}
                  </td>
                  <td className="text-right font-semibold tabular-nums">{fmtPeso(m.deposito, { gramos: g && m.deposito < 10 })}</td>
                  <td className="text-right tabular-nums text-foreground-muted">{m.minimo ? fmtPeso(m.minimo) : "—"}</td>
                  <td>
                    <Semaforo estado={m.estado} />
                  </td>
                  <td className="text-right">
                    <Link href={`/materia-prima/${m.id}`} className="btn btn-outline btn-sm">
                      Lotes y certificados
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-foreground-muted">
        {visibles.length} de {stock.length}. Al entrar a cada material se ven sus lotes, certificados y movimientos. Ingresos, salidas a pie de máquina y devoluciones: pestaña Movimientos (filtrá «Stock general»).
      </p>
      <section className="panel overflow-x-auto p-0">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="panel-titulo mb-0 w-auto border-0">Últimos movimientos del stock general</h2>
          <Link href="/materia-prima?vista=movimientos&ubic=deposito" className="text-xs font-semibold text-accent hover:underline">
            Ver todos →
          </Link>
        </div>
        <TablaMovs movs={movs} />
      </section>
    </section>
  );
}

async function Movimientos({ stock, sp }: { stock: Stock; sp: { desde?: string; hasta?: string; mp?: string; ubic?: string } }) {
  const hasta = sp.hasta ?? hoyISO();
  const desde = sp.desde ?? new Date(Date.parse(`${hasta}T12:00:00Z`) - 14 * 86_400_000).toISOString().slice(0, 10);
  const ubic = sp.ubic === "deposito" || sp.ubic === "pie" || sp.ubic === "proceso" ? sp.ubic : undefined;
  const movs = await movimientosMp({ desde, hasta, materiaPrimaId: sp.mp ? Number(sp.mp) : undefined, ubicacion: ubic, limite: 500 });
  const porDia = new Map<string, typeof movs>();
  for (const m of movs) {
    const d = fmtDia(m.fecha);
    porDia.set(d, [...(porDia.get(d) ?? []), m]);
  }
  return (
    <section className="space-y-3">
      <form action="/materia-prima" className="panel flex flex-wrap items-end gap-2">
        <input type="hidden" name="vista" value="movimientos" />
        <label className="campo">
          <span>Desde</span>
          <input type="date" name="desde" defaultValue={desde} className="input" />
        </label>
        <label className="campo">
          <span>Hasta</span>
          <input type="date" name="hasta" defaultValue={hasta} className="input" />
        </label>
        <label className="campo min-w-56 flex-1">
          <span>Material</span>
          <select name="mp" defaultValue={sp.mp ?? ""} className="input">
            <option value="">Todos</option>
            {stock.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Ubicación</span>
          <select name="ubic" defaultValue={ubic ?? ""} className="input">
            <option value="">Todas</option>
            <option value="deposito">Stock general</option>
            <option value="pie">Stock a pie de máquina</option>
            <option value="proceso">Tolva / en proceso</option>
          </select>
        </label>
        <button className="btn btn-azul">Ver</button>
      </form>
      {porDia.size === 0 && <p className="panel text-sm text-foreground-muted">Sin movimientos en el período.</p>}
      {[...porDia.entries()].map(([dia, lista]) => (
        <div key={dia} className="panel overflow-x-auto p-0">
          <h3 className="panel-titulo mx-5 mt-4">{dia}</h3>
          <table className="tabla">
            <thead>
              <tr>
                <th>Hora</th>
                <th>Ubicación</th>
                <th>Material</th>
                <th className="text-right">Kg</th>
                <th>Origen</th>
                <th>Observaciones</th>
                <th>Responsable</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap text-xs">{fmtHora(m.fecha)}</td>
                  <td className="whitespace-nowrap">{m.ubicacion}</td>
                  <td>
                    {m.materiaPrima}
                    {m.lote && <div className="font-mono text-[11px] text-foreground-muted">lote {m.lote}</div>}
                  </td>
                  <td className={`text-right font-semibold tabular-nums ${m.kg < 0 ? "text-[var(--estado-critico-fg)]" : "text-[var(--estado-ok-fg)]"}`}>
                    {m.kg > 0 ? "+" : ""}
                    {fmtNumero(m.kg, 3)}
                  </td>
                  <td className="whitespace-nowrap">{m.origen}</td>
                  <td className="max-w-80 text-xs text-foreground-muted">{m.motivo}</td>
                  <td className="whitespace-nowrap">{m.usuario}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

async function Pie() {
  const [pie, { novedades, excepciones }, presentaciones, movs] = await Promise.all([pieDeMaquina(), relevosRecientes(15), listarPresentaciones(), movimientosMp({ ubicacion: "pie", limite: 20 })]);
  // Indicadores: qué debería haber junto a cada inyectora según los movimientos
  // registrados (saldo calculado, no un conteo físico).
  const porIny = new Map<string, Map<number, { nombre: string; tipo: string; kg: number }>>();
  for (const r of pie)
    for (const l of r.lineas) {
      if (l.anulado || l.saldo.pie <= 0) continue;
      const m = porIny.get(r.inyectora) ?? new Map();
      const a = m.get(l.materiaPrimaId) ?? { nombre: l.materiaPrimaNombre, tipo: l.materiaPrimaTipo, kg: 0 };
      a.kg = Math.round((a.kg + l.saldo.pie) * 1000) / 1000;
      m.set(l.materiaPrimaId, a);
      porIny.set(r.inyectora, m);
    }
  return (
    <div className="space-y-5">
      {porIny.size === 0 ? (
        <p className="panel text-sm text-foreground-muted">No hay material a pie de máquina.</p>
      ) : (
        [...porIny.entries()].map(([iny, mats]) => (
          <section key={iny} className="space-y-2">
            <h2 className="panel-titulo">{etiquetaInyectora(iny)} · debería haber junto a la máquina</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[...mats.entries()].map(([id, m]) => (
                <div key={id} className="stat-card">
                  <div className="stat-label">{m.nombre}</div>
                  <div className="stat-valor text-lg">{enBolsas(m.kg, presentacionesDe(presentaciones, { id, tipo: m.tipo })) ?? fmtPeso(m.kg, { gramos: m.tipo === "MASTER" })}</div>
                  <div className="text-xs text-foreground-muted">{fmtPeso(m.kg, { gramos: m.tipo === "MASTER" && m.kg < 10 })}</div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
      <p className="text-xs text-foreground-muted">Calculado con los movimientos registrados (retirado − cargado en tolva − devuelto − diferencias). No reemplaza el control físico.</p>
      <section className="panel overflow-x-auto p-0">
        <div className="px-5 pt-4">
          <h2 className="panel-titulo">Retiros abiertos (traslados del stock general al pie de máquina)</h2>
          <p className="mb-3 text-xs text-foreground-muted">Material retirado del depósito y todavía no cargado, devuelto ni justificado. Sigue abierto entre turnos hasta conciliar.</p>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th>Retiro</th>
              <th>Inyectora</th>
              <th>Producción · partida NEXA</th>
              <th className="text-right">Retirado</th>
              <th className="text-right">Cargado en tolva</th>
              <th className="text-right">Devuelto</th>
              <th className="text-right">A pie de máquina</th>
            </tr>
          </thead>
          <tbody>
            {pie.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/materia-prima/retiros/${r.id}`} className="font-semibold text-accent hover:underline">
                    {r.numero}
                  </Link>
                </td>
                <td>{etiquetaInyectora(r.inyectora)}</td>
                <td>{r.cicloId ? `#${r.cicloId}${r.partidaNumero != null ? ` · N° ${r.partidaNumero}` : ""}` : "sin producción"}</td>
                <td className="text-right tabular-nums">{fmtNumero(r.totales.retirado, 3)} kg</td>
                <td className="text-right tabular-nums">{fmtNumero(r.totales.cargado, 3)} kg</td>
                <td className="text-right tabular-nums">{fmtNumero(r.totales.devuelto, 3)} kg</td>
                <td className={`text-right font-semibold tabular-nums ${r.totales.pie > 0 ? "text-[var(--estado-bajo-fg)]" : ""}`}>{fmtNumero(r.totales.pie, 3)} kg</td>
              </tr>
            ))}
            {pie.length === 0 && (
              <tr>
                <td colSpan={7} className="text-foreground-muted">
                  No hay retiros abiertos.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <section className="panel overflow-x-auto p-0">
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="panel-titulo mb-0 w-auto border-0">Movimientos del stock a pie de máquina</h2>
          <Link href="/materia-prima?vista=movimientos&ubic=pie" className="text-xs font-semibold text-accent hover:underline">
            Ver todos →
          </Link>
        </div>
        <TablaMovs movs={movs} />
      </section>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="panel">
          <h2 className="panel-titulo">Diferencias en relevos y cargas sin hacer</h2>
          {novedades.filter(({ n }) => n.tipo === "DIFERENCIA_RELEVO" || n.tipo === "NO_CARGA").length === 0 ? (
            <p className="text-sm text-foreground-muted">Sin diferencias informadas.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {novedades
                .filter(({ n }) => n.tipo === "DIFERENCIA_RELEVO" || n.tipo === "NO_CARGA")
                .map(({ n, usuarioNombre }) => (
                  <li key={n.id}>
                    <b>{n.motivo}</b> · Iny. {n.inyectora}
                    {n.detalle ? ` · ${n.detalle}` : ""}
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
                <li key={e.id}>
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

async function Ajustes({ stock, ajusta, alta, corrige }: { stock: Stock; ajusta: boolean; alta: boolean; corrige: boolean }) {
  const [presentaciones, fracc] = await Promise.all([listarPresentaciones(), fraccionamientosRecientes(10)]);
  const masters = stock.filter((m) => m.tipo === "MASTER");
  const moliendas = stock.filter((m) => m.tipo === "MOLIENDA" || m.tipo === "SOBRANTE");
  if (!ajusta && !alta) return <p className="panel text-sm text-foreground-muted">Los ajustes los registra Materia prima; las correcciones, Supervisión o Gerencia.</p>;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="panel">
        <h2 className="panel-titulo">Devolución de material al stock general</h2>
        <p className="text-sm text-foreground-muted">
          El material sin mezclar que vuelve de pie de máquina (bolsas o bolsitas sin usar) se registra en el retiro correspondiente con «Devolver sin mezclar»: vuelve al
          stock general sin duplicar la cantidad.
        </p>
        <Link href="/materia-prima?vista=pie" className="btn btn-outline btn-sm mt-3">
          Ir a los retiros a pie de máquina
        </Link>
      </section>
      <section className="panel">
        <h2 className="panel-titulo">Registro de sobrante</h2>
        <p className="text-sm text-foreground-muted">
          El material mezclado con master que se baja de la tolva se registra al finalizar la producción (pantalla del operario) o en el retiro, con su código de sobrante:
          nunca vuelve como material virgen.
        </p>
        <Link href="/materia-prima?vista=pie" className="btn btn-outline btn-sm mt-3">
          Ir a los retiros a pie de máquina
        </Link>
      </section>
      {ajusta && (
        <section className="panel">
          <h2 className="panel-titulo">Ajuste de balanza</h2>
          <FormAccion accion={ajusteMpAction} boton="Registrar ajuste" className="space-y-3">
            <SelectMp stock={stock} />
            <div className="grid grid-cols-3 gap-2">
              <label className="campo">
                <span>Dónde</span>
                <select name="ubicacion" className="input" defaultValue="deposito">
                  <option value="deposito">Stock general</option>
                  <option value="pie">Stock a pie de máquina</option>
                </select>
              </label>
              <label className="campo">
                <span>Qué pasó</span>
                <select name="sentido" className="input" defaultValue="falta">
                  <option value="falta">Falta</option>
                  <option value="sobra">Sobra</option>
                </select>
              </label>
              <label className="campo">
                <span>Kg</span>
                <input name="kg" inputMode="decimal" required placeholder="0,350" className="input" />
              </label>
            </div>
            <label className="campo">
              <span>Motivo</span>
              <select name="motivo" required defaultValue="" className="input">
                <option value="" disabled>
                  Elegí…
                </option>
                {MOTIVOS_AJUSTE_MP.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <input name="detalle" placeholder="Detalle (ej. bolsa de 25 kg terminó con 24,65 kg)" className="input" />
          </FormAccion>
        </section>
      )}
      {ajusta && (
        <section className="panel">
          <h2 className="panel-titulo">Molienda (bolsones)</h2>
          <p className="mb-3 text-xs text-foreground-muted">El scrap molido se pesa y se vuelca en bolsones de peso variable. Cada bolsón queda con su código para retirarlo y descontarlo al usarlo.</p>
          <FormAccion accion={bolsonAction} boton="Registrar bolsón" className="space-y-3">
            <label className="campo">
              <span>Código de molienda o sobrante</span>
              <select name="materiaPrimaId" required defaultValue="" className="input">
                <option value="" disabled>
                  Elegí…
                </option>
                {moliendas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="campo">
              <span>Peso del bolsón (kg)</span>
              <input name="kg" inputMode="decimal" required placeholder="Ej.: 312,4" className="input" />
            </label>
            <input name="observaciones" placeholder="Observaciones (opcional)" className="input" />
          </FormAccion>
        </section>
      )}
      {ajusta && (
        <section className="panel">
          <h2 className="panel-titulo">Fraccionamiento de master</h2>
          <p className="mb-3 text-xs text-foreground-muted">De la bolsa grande se arman bolsitas. Los kilos no cambian; las bolsitas sin usar vuelven con la devolución del retiro.</p>
          <FormAccion accion={fraccionarAction} boton="Registrar fraccionamiento" className="space-y-3">
            <label className="campo">
              <span>Master</span>
              <select name="materiaPrimaId" required defaultValue="" className="input">
                <option value="" disabled>
                  Elegí…
                </option>
                {masters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre} · hay {fmtPeso(m.deposito, { gramos: true })}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="campo">
                <span>Bolsitas de</span>
                <select name="presentacionId" required className="input">
                  {presentaciones
                    .filter((p) => p.tipoMp === "MASTER" || p.materiaPrimaId != null)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                </select>
              </label>
              <label className="campo">
                <span>Cantidad</span>
                <input name="cantidad" type="number" min={1} step={1} required className="input" />
              </label>
            </div>
          </FormAccion>
          {fracc.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-foreground-muted">
              {fracc.map(({ f, mp, presentacion, usuario }) => (
                <li key={f.id}>
                  {fmtFechaHora(f.fecha)} · {f.cantidad} × {presentacion} de {mp} · {usuario}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {alta && (
        <section className="panel">
          <h2 className="panel-titulo">Alta de material</h2>
          <p className="mb-3 text-xs text-foreground-muted">Un color nuevo de master, o un material que resulta de una mezcla (ej. «polipropileno con master negro»): se identifica como tal para no confundirlo con material virgen.</p>
          <FormAccion accion={altaMpAction} boton="Dar de alta" className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <label className="campo">
                <span>Código</span>
                <input name="codigoInterno" required placeholder="A15" className="input" />
              </label>
              <label className="campo col-span-2">
                <span>Nombre</span>
                <input name="nombre" required placeholder="A15-Master violeta 3360" className="input" />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="campo">
                <span>Tipo</span>
                <select name="tipo" required className="input" defaultValue="MASTER">
                  <option value="VIRGEN">Materia prima virgen</option>
                  <option value="MASTER">Master</option>
                  <option value="SOBRANTE">Sobrante (mezcla con master)</option>
                  <option value="MOLIENDA">Molienda</option>
                </select>
              </label>
              <label className="campo">
                <span>Proveedor</span>
                <input name="proveedor" className="input" />
              </label>
            </div>
            <input name="motivo" placeholder="Motivo (queda en el historial)" className="input" />
          </FormAccion>
        </section>
      )}
      {corrige && (
        <section className="panel">
          <h2 className="panel-titulo">Corrección autorizada (Supervisión o Gerencia)</h2>
          <p className="text-sm text-foreground-muted">
            Los datos ya confirmados se corrigen con anulaciones o ajustes auditados, nunca borrando: los kg de un lote se corrigen desde la materia prima (botón «Lotes y
            certificados»); retiros y cargas, desde el retiro («Anular línea» / «Anular movimiento»).
          </p>
        </section>
      )}
    </div>
  );
}

function SelectMp({ stock }: { stock: Stock }) {
  return (
    <label className="campo">
      <span>Material</span>
      <select name="materiaPrimaId" required defaultValue="" className="input">
        <option value="" disabled>
          Elegí…
        </option>
        {stock.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}

function TablaMovs({ movs }: { movs: Awaited<ReturnType<typeof movimientosMp>> }) {
  return (
    <table className="tabla">
      <thead>
        <tr>
          <th>Fecha</th>
          <th>Material</th>
          <th className="text-right">Kg</th>
          <th>Origen</th>
          <th>Observaciones</th>
          <th>Responsable</th>
        </tr>
      </thead>
      <tbody>
        {movs.map((m) => (
          <tr key={m.id}>
            <td className="whitespace-nowrap text-xs">{fmtFechaHora(m.fecha)}</td>
            <td>{m.materiaPrima}</td>
            <td className={`text-right font-semibold tabular-nums ${m.kg < 0 ? "text-[var(--estado-critico-fg)]" : "text-[var(--estado-ok-fg)]"}`}>
              {m.kg > 0 ? "+" : ""}
              {fmtNumero(m.kg, 3)}
            </td>
            <td className="whitespace-nowrap">{m.origen}</td>
            <td className="max-w-80 text-xs text-foreground-muted">{m.motivo}</td>
            <td className="whitespace-nowrap">{m.usuario}</td>
          </tr>
        ))}
        {movs.length === 0 && (
          <tr>
            <td colSpan={6} className="text-foreground-muted">
              Sin movimientos.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
