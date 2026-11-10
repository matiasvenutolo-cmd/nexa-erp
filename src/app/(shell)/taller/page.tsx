import Link from "next/link";
import { cookies } from "next/headers";
import { getUsuarioActual } from "@/lib/session";
import { eventosDe, inyectorasActivas, vistaTaller, type MaterialEnMaquina, MOTIVOS_DIFERENCIA_RELEVO, MOTIVOS_EXCEPCION_CARGA, MOTIVOS_NO_CARGA } from "@/lib/data/taller";
import { TURNOS, etiquetaTurno, ultimosGolpes } from "@/lib/data/planificacion";
import { opcionesTurno, type OpcionesTurno } from "@/lib/data/turnos";
import { getUsuariosPorRol } from "@/lib/data/usuarios";
import { horarioDe } from "@/lib/turnos";
import { codigosDeSobrante } from "@/lib/data/maquina";
import { nombreCortoMp } from "@/lib/codigos-mp";
import { INYECTORAS } from "@/lib/inyectoras";
import { FormAccion } from "@/components/form-accion";
import {
  cargarRecetaAction,
  cerrarProduccionTallerAction,
  cerrarTurnoAction,
  iniciarTandaAction,
  pausarAction,
  pedirMaterialAction,
  tomarTurnoAction,
} from "@/app/actions/taller";
import { fmtFecha, fmtHora, fmtNumero } from "@/lib/format";
import { aGramos, fmtPeso } from "@/lib/presentaciones";
import { CamposCierre, CargaDistinta, COOKIE_MAQUINA, ElegirTurno, FaltaMaterialRelevo, Opciones, RecordarMaquina, type ItemCarga } from "./componentes";
import type { Receta } from "@/lib/data/recetas";

/**
 * Mi turno — app del operario por estados (Cambios en Producción, nov. 2026).
 * Un estado por vez, con un botón principal grande y como mucho dos o tres
 * opciones secundarias:
 *   sin tanda → tanda en cola (Arrancar) → falta cargar (Ya cargué) →
 *   produciendo (Cargué otra vez · Terminar · Pausar · Cerrar mi turno);
 *   relevo (Recibí la máquina) y pausada (Reanudar) en el medio.
 * El material sale siempre del pie de máquina; lo lleva el Encargado o
 * Retiros de MP. Cancelar una producción es del Encargado (Producción → En curso).
 */
export default async function TallerPage({ searchParams }: { searchParams: Promise<{ iny?: string; elegir?: string }> }) {
  const usuario = await getUsuarioActual();
  const sp = await searchParams;
  const [activas, ot, recordada] = await Promise.all([inyectorasActivas(), opcionesTurno(usuario.id), cookies().then((c) => c.get(COOKIE_MAQUINA)?.value)]);
  const turno = ot.sugerido;
  const valida = (x: string | null | undefined) => (x && (INYECTORAS as readonly string[]).includes(x) ? x : null);
  const asignada = ot.asignado?.inyectora && activas.some((a) => a.inyectora === ot.asignado!.inyectora) ? ot.asignado.inyectora : null;
  // La máquina queda recordada en el celular; «Cambiar de máquina» lleva a la lista.
  const iny = sp.elegir === "1" ? null : (valida(sp.iny) ?? valida(recordada) ?? (activas.length === 1 ? activas[0].inyectora : asignada));
  const textoTurno = turno
    ? `Turno ${etiquetaTurno(turno.turno)} (${horarioDe(turno.esquema, turno.turno)})`
    : ot.posibles.length > 1
      ? "Hay dos turnos activos: elegí el tuyo al empezar"
      : ot.sinEsquema
        ? "El Encargado todavía no cargó el esquema de turnos de hoy"
        : "Fuera del horario de los turnos de hoy";

  if (!iny) return <ElegirMaquina activas={activas} ot={ot} textoTurno={textoTurno} usuarioNombre={usuario.nombre} />;

  // Quien no es operario (Encargado o Supervisión, «Ver como el operario») arranca
  // y recibe la máquina en nombre de un operario, con motivo.
  const enNombre = usuario.rol !== "OPERARIO";
  const [v, golpes, operarios] = await Promise.all([vistaTaller(iny), ultimosGolpes(iny), enNombre ? getUsuariosPorRol("OPERARIO") : Promise.resolve([])]);
  const p = v.produccion;
  const quien: Quien = { usuarioNombre: usuario.nombre, enNombre, operarios: operarios.map((o) => o.nombre) };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <RecordarMaquina iny={iny} />
      <div className="flex items-center justify-between gap-2">
        <details className="relative">
          <summary className="btn btn-ghost btn-sm list-none">☰ Menú</summary>
          <div className="absolute left-0 z-10 mt-1 w-56 rounded-xl border border-border bg-white p-2 shadow-lg">
            <Link href="/taller?elegir=1" className="block rounded-lg px-3 py-2 text-sm font-semibold hover:bg-surface-muted">
              Cambiar de máquina
            </Link>
          </div>
        </details>
        <span className="text-right text-xs font-semibold text-foreground-muted">
          Inyectora {iny} · {textoTurno} · {usuario.nombre}
        </span>
      </div>

      {!p ? <EnCola v={v} iny={iny} golpes={golpes} ot={ot} quien={quien} /> : <ConProduccion v={v} p={p} ot={ot} quien={quien} />}
    </div>
  );
}

type Vista = Awaited<ReturnType<typeof vistaTaller>>;
type Prod = NonNullable<Vista["produccion"]>;
type Mat = readonly MaterialEnMaquina[];
type Quien = { usuarioNombre: string; enNombre: boolean; operarios: string[] };

function ElegirMaquina({ activas, ot, textoTurno, usuarioNombre }: { activas: { inyectora: string; detalle: string }[]; ot: OpcionesTurno; textoTurno: string; usuarioNombre: string }) {
  // Las máquinas de NEXA (baldosas en la 8, accesorios en la 6) y las que tengan algo en curso o en cola.
  const lista = [...new Set([...activas.map((a) => a.inyectora), "8", "6"])].map((i) => ({ inyectora: i, detalle: activas.find((a) => a.inyectora === i)?.detalle ?? "Sin tanda en la cola" }));
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <section className="panel">
        <h1 className="text-2xl">¿En qué máquina vas a trabajar?</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          {textoTurno} · {usuarioNombre}
        </p>
        {ot.asignado && (
          <p className="aviso aviso-info mt-3 text-sm">
            El Encargado te asignó al turno {etiquetaTurno(ot.asignado.turno)}
            {ot.asignado.inyectora ? ` en la inyectora ${ot.asignado.inyectora}` : ""}.
          </p>
        )}
        <ul className="mt-4 space-y-2">
          {lista.map((a) => (
            <li key={a.inyectora}>
              <Link href={`/taller?iny=${a.inyectora}`} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-white p-4 hover:border-accent">
                <span>
                  <span className="block font-[family-name:var(--font-display)] text-xl font-bold text-brand-azul">Inyectora {a.inyectora}</span>
                  <span className="block text-sm text-foreground-muted">{a.detalle}</span>
                </span>
                <span className="btn btn-primary btn-sm">Elegir</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Materiales({ titulo, lista, vacio }: { titulo: string; lista: Mat; vacio?: string }) {
  return (
    <div className="mt-3 text-left">
      <div className="text-xs font-bold uppercase tracking-wide text-foreground-muted">{titulo}</div>
      {lista.length === 0 ? (
        <p className="text-sm text-foreground-muted">{vacio ?? "Nada."}</p>
      ) : (
        <ul className="mt-1 space-y-1 text-sm">
          {lista.map((m) => (
            <li key={m.materiaPrimaId} className="flex justify-between gap-3">
              <span>{m.nombre}</span>
              <span className="text-right font-semibold">{m.bolsas ?? fmtPeso(m.kg, { gramos: m.esMaster })}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TextoReceta({ receta }: { receta: Receta }) {
  return (
    <ul className="space-y-1">
      {receta.items.map((i) => (
        <li key={`${i.materiaPrimaId}-${i.presentacionId}`} className="flex justify-between gap-3">
          <span>{nombreCortoMp(i.materiaPrimaNombre)}</span>
          <b>{i.texto}</b>
        </li>
      ))}
    </ul>
  );
}

function DespuesSigue({ t }: { t: Vista["asignadas"][number] | undefined }) {
  if (!t) return null;
  return (
    <p className="text-sm text-foreground-muted">
      Después sigue: <b className="text-foreground">{t.colorNombre ?? "—"}</b> · {t.productoDescripcion} · {fmtNumero(t.cantidad, 0)} u.
    </p>
  );
}

/** Quién trabaja: la cuenta compartida «Taller» escribe su nombre; el Encargado elige al operario. */
function CampoOperario({ quien, sugerido }: { quien: Quien; sugerido?: string | null }) {
  if (quien.enNombre) {
    return (
      <label className="campo">
        <span>Operario que está en la máquina</span>
        <select name="operarioNombre" required defaultValue={sugerido ?? ""} className="input">
          <option value="" disabled>
            Elegí…
          </option>
          {quien.operarios.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <span className="campo-ayuda">Estás arrancando en nombre del operario: queda registrado con el motivo.</span>
      </label>
    );
  }
  if (quien.usuarioNombre !== CUENTA_COMPARTIDA) {
    return (
      <p className="text-sm text-foreground-muted">
        Queda registrado a nombre de <b className="text-foreground">{quien.usuarioNombre}</b>.
      </p>
    );
  }
  return (
    <label className="campo">
      <span>Tu nombre</span>
      <input name="operarioNombre" required placeholder="Quién trabaja en este turno" className="input" />
      <span className="campo-ayuda">Estás con la cuenta compartida del taller: escribí tu nombre para que el registro quede a tu nombre.</span>
    </label>
  );
}

/** Nombre de la cuenta compartida del taller (usuario «Taller» con PIN). */
const CUENTA_COMPARTIDA = "Taller";

function CampoTurno({ ot, sugerido }: { ot: OpcionesTurno; sugerido?: string | null }) {
  if (!ot.preguntar) return null;
  return (
    <div className="campo">
      <span>{ot.posibles.length > 1 ? "¿En qué turno estás? (ahora hay dos activos)" : "¿En qué turno estás?"}</span>
      <ElegirTurno turnos={TURNOS.filter((x) => ot.opciones.includes(x.valor))} sugerido={sugerido && ot.opciones.includes(sugerido as never) ? sugerido : null} />
    </div>
  );
}

/** Arrancar: golpes de inicio precargados, quién trabaja, turno y, si hace falta, el motivo. */
function FormArrancar({ t, golpes, ot, quien, conMotivo, boton }: { t: Vista["asignadas"][number]; golpes: number | null; ot: OpcionesTurno; quien: Quien; conMotivo: boolean; boton: string }) {
  return (
    <FormAccion accion={iniciarTandaAction} ocultos={{ tandaId: t.id }} boton={boton} claseBoton="btn btn-primary btn-lg btn-block" className="space-y-3">
      <label className="campo">
        <span>Golpes que marca el contador</span>
        <input name="golpesInicio" inputMode="numeric" required defaultValue={golpes ?? ""} className="input text-lg" />
        {golpes != null && <span className="campo-ayuda">Viene del cierre anterior de esta máquina ({fmtNumero(golpes, 0)}). Corregilo si el contador marca otro número.</span>}
      </label>
      <CampoOperario quien={quien} />
      <CampoTurno ot={ot} sugerido={t.turno} />
      {(conMotivo || quien.enNombre) && <input name="motivo" required placeholder={conMotivo ? "Motivo para arrancar esta tanda antes" : "Motivo (ej. el operario no tiene el celular)"} className="input" />}
    </FormAccion>
  );
}

/** Sin producción en curso: la primera tanda de la cola, para arrancarla. */
function EnCola({ v, iny, golpes, ot, quien }: { v: Vista; iny: string; golpes: number | null; ot: OpcionesTurno; quien: Quien }) {
  const t = v.asignadas[0];
  if (!t) {
    return (
      <section className="panel space-y-3">
        <h1 className="text-2xl">Inyectora {iny}</h1>
        <p className="aviso aviso-info">No hay tanda en la cola de esta máquina. Avisá al Encargado.</p>
        {v.pie.length > 0 && <Materiales titulo="Material a pie de máquina" lista={v.pie} />}
      </section>
    );
  }
  const otras = v.asignadas.slice(1).filter((x) => x.sePuedeArrancar);
  return (
    <>
      <section className="panel space-y-4">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-foreground-muted">
            Tanda en cola{t.fecha ? ` · ${fmtFecha(t.fecha)}` : ""}
            {t.turno ? ` · turno ${etiquetaTurno(t.turno)}` : ""}
          </div>
          <div className="mt-1 flex items-center gap-2">
            {t.colorHex && <span className="h-6 w-6 rounded border border-[rgba(29,43,58,0.2)]" style={{ background: t.colorHex }} />}
            <h1 className="text-[1.7rem] leading-tight">{t.colorNombre ?? "—"}</h1>
          </div>
          <div className="text-sm text-foreground-muted">
            {t.productoDescripcion} · <b className="text-foreground">{fmtNumero(t.cantidad, 0)} piezas</b>
          </div>
        </div>
        <div className="rounded-xl bg-surface-muted p-3 text-sm">
          {t.enPie.length > 0 ? (
            <Materiales titulo="✓ El material ya está a pie de máquina" lista={t.enPie} />
          ) : (
            <p className="font-semibold text-[var(--estado-bajo-fg)]">Todavía no llevaron el material a pie de máquina.</p>
          )}
          {t.receta ? (
            <div className="mt-3">
              <div className="text-xs font-bold uppercase tracking-wide text-foreground-muted">Cada carga</div>
              <TextoReceta receta={t.receta} />
            </div>
          ) : (
            <p className="aviso aviso-alerta mt-2">Esta tanda no tiene receta de carga: avisale al Encargado.</p>
          )}
          {t.observaciones && <p className="mt-2">Indicaciones: {t.observaciones}</p>}
        </div>
        {t.sePuedeArrancar ? (
          <FormArrancar t={t} golpes={golpes} ot={ot} quien={quien} conMotivo={false} boton="Arrancar" />
        ) : (
          <p className="aviso aviso-info">Está programada para el {fmtFecha(t.fecha!)}: todavía no se puede arrancar. Si hay que adelantarla, avisale al Encargado.</p>
        )}
        <DespuesSigue t={v.asignadas[1]} />
      </section>
      {otras.length > 0 && (
        <details className="panel">
          <summary className="cursor-pointer font-semibold">Arrancar otra tanda de la cola</summary>
          <p className="mt-2 text-xs text-foreground-muted">Sólo si no se puede hacer la primera: pide el motivo y le avisa al Encargado.</p>
          <div className="mt-3 space-y-4">
            {otras.map((x) => (
              <div key={x.id} className="space-y-2 rounded-xl border border-border p-3">
                <div className="font-semibold">
                  {x.colorNombre ?? "—"} · {x.productoDescripcion} · {fmtNumero(x.cantidad, 0)} u.
                </div>
                <FormArrancar t={x} golpes={golpes} ot={ot} quien={quien} conMotivo boton="Arrancar esta" />
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function itemsDe(r: Receta, pie: Mat): ItemCarga[] {
  return r.items.map((i) => ({
    materiaPrimaId: i.materiaPrimaId,
    presentacionId: i.presentacionId,
    nombre: nombreCortoMp(i.materiaPrimaNombre),
    presentacion: i.presentacionNombre,
    kgPres: i.kgPresentacion,
    cantidad: i.cantidad,
    esMaster: i.esMaster,
    enPie: pie.find((m) => m.materiaPrimaId === i.materiaPrimaId)?.kg ?? 0,
  }));
}

/** ¿Alcanza lo que hay a pie de máquina para una carga de la receta? */
function alcanza(r: Receta, pie: Mat): boolean {
  const pide = new Map<number, number>();
  for (const i of r.items) pide.set(i.materiaPrimaId, (aGramos(pide.get(i.materiaPrimaId) ?? 0) + aGramos(i.kg)) / 1000);
  return [...pide].every(([mp, kg]) => aGramos(pie.find((m) => m.materiaPrimaId === mp)?.kg ?? 0) >= aGramos(kg));
}

function ConProduccion({ v, p, ot, quien }: { v: Vista; p: Prod; ot: OpcionesTurno; quien: Quien }) {
  const operario = p.turnoAbierto ? (p.turnoAbierto.operarioNombre ?? p.turnoAbierto.usuarioNombre) : null;
  const estado = !p.turnoAbierto ? "RELEVO" : p.pausada ? "PAUSADA" : !p.hayCargas ? "FALTA_CARGAR" : "PRODUCIENDO";
  return (
    <>
      <section className="panel">
        <div className="text-xs font-bold uppercase tracking-wider text-foreground-muted">
          {p.turnoAbierto ? `Turno ${etiquetaTurno(p.turnoAbierto.turno)} · ${operario}` : "Sin turno tomado"}
        </div>
        <h1 className="mt-1 text-[1.7rem] leading-tight">{p.colorNombre ?? "—"}</h1>
        <div className="text-sm text-foreground-muted">
          {p.productoDescripcion} · {p.objetivo != null ? `${fmtNumero(p.objetivo, 0)} piezas` : "sin cantidad objetivo"}
        </div>
      </section>
      {estado === "RELEVO" && <Relevo p={p} pie={v.pie} ot={ot} quien={quien} />}
      {estado === "PAUSADA" && <Pausada p={p} />}
      {estado === "FALTA_CARGAR" && <FaltaCargar p={p} pie={v.pie} />}
      {estado === "PRODUCIENDO" && <Produciendo v={v} p={p} />}
    </>
  );
}

/** Turno entrante: cuenta las bolsas a pie de máquina y recibe la máquina. */
function Relevo({ p, pie, ot, quien }: { p: Prod; pie: Mat; ot: OpcionesTurno; quien: Quien }) {
  const u = p.ultimoTurno;
  return (
    <section className="panel space-y-4">
      {u && (
        <div className="rounded-xl bg-surface-muted p-3 text-sm">
          <div className="font-semibold">
            Relevo del turno {etiquetaTurno(u.turno)} ({u.operarioNombre ?? u.usuarioNombre}) · el contador quedó en {u.golpesFin != null ? fmtNumero(u.golpesFin, 0) : "—"}
          </div>
          {u.observaciones && <div>Indicaciones: {u.observaciones}</div>}
        </div>
      )}
      <Materiales titulo="A pie de máquina (contá las bolsas)" lista={pie} vacio="No queda material a pie de máquina." />
      {p.hayCargas && p.tolvaEstimadaKg != null && (
        <p className="text-sm text-foreground-muted">
          En la tolva quedan ≈ {fmtNumero(p.tolvaEstimadaKg, 0)} kg (estimado, sólo informativo).
        </p>
      )}
      <FormAccion accion={tomarTurnoAction} ocultos={{ cicloId: p.cicloId }} boton="Recibí la máquina" claseBoton="btn btn-primary btn-lg btn-block" className="space-y-4">
        <CampoOperario quien={quien} />
        <CampoTurno ot={ot} sugerido={ot.asignado?.turno ?? null} />
        {u && <FaltaMaterialRelevo motivos={MOTIVOS_DIFERENCIA_RELEVO.filter((m) => m !== "Sobran bolsas")} />}
      </FormAccion>
    </section>
  );
}

async function Pausada({ p }: { p: Prod }) {
  const eventos = await eventosDe(p.cicloId);
  const pausa = [...eventos].reverse().find((e) => e.e.tipo === "PAUSA");
  return (
    <section className="panel space-y-4">
      <div className="aviso aviso-alerta">
        <b>Producción pausada</b>
        {pausa ? ` desde las ${fmtHora(pausa.e.fecha)}` : ""}
        {pausa?.e.motivo ? `: ${pausa.e.motivo}` : ""}
      </div>
      <FormAccion accion={pausarAction} ocultos={{ cicloId: p.cicloId, reanudar: 1 }} boton="Reanudar" claseBoton="btn btn-primary btn-lg btn-block" className="space-y-2" />
    </section>
  );
}

/** La carga de la receta: un toque si alcanza; si no, pedir material o cargar lo que hay. */
function Carga({ p, pie, principal, secundarias = true }: { p: Prod; pie: Mat; principal: string; secundarias?: boolean }) {
  const receta = p.usarArranque && p.recetaArranque ? p.recetaArranque : p.receta;
  const tipo = p.usarArranque && p.recetaArranque ? "ARRANQUE" : "REGIMEN";
  if (!receta) return <p className="aviso aviso-alerta">Este producto no tiene receta de carga. Avisale al Encargado para que la defina.</p>;
  const ok = alcanza(receta, pie);
  const hayAlgo = pie.some((m) => m.kg > 0);
  const pedir = <FormAccion accion={pedirMaterialAction} ocultos={{ cicloId: p.cicloId }} boton="Pedir material" claseBoton={ok ? "btn btn-outline btn-block" : "btn btn-azul btn-lg btn-block"} className="space-y-2" />;
  const distinto = (
    <FormAccion accion={cargarRecetaAction} ocultos={{ cicloId: p.cicloId, tipo }} boton="Registrar lo que cargué" claseBoton="btn btn-azul btn-block" className="space-y-3">
      <CargaDistinta items={itemsDe(receta, pie)} motivos={MOTIVOS_EXCEPCION_CARGA} />
    </FormAccion>
  );
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-surface-muted p-3 text-sm">
        <div className="text-xs font-bold uppercase tracking-wide text-foreground-muted">{tipo === "ARRANQUE" ? "Carga de arranque (cambio de color)" : "Cada carga"}</div>
        <TextoReceta receta={receta} />
      </div>
      {ok ? (
        <>
          <FormAccion accion={cargarRecetaAction} ocultos={{ cicloId: p.cicloId, tipo }} boton={principal} claseBoton="btn btn-azul btn-lg btn-block" className="space-y-2" />
          {secundarias && (
          <Opciones
            opciones={[
              { id: "distinto", label: "Cargué distinto", contenido: distinto },
              { id: "pedir", label: "Pedir material", contenido: pedir },
            ]}
          />
          )}
        </>
      ) : (
        <>
          <p className="text-sm font-semibold text-[var(--estado-critico-fg)]">A pie de máquina no alcanza para una carga.</p>
          {pedir}
          {hayAlgo && <Opciones opciones={[{ id: "distinto", label: "Cargué lo que había", contenido: distinto }]} />}
        </>
      )}
    </div>
  );
}

function FaltaCargar({ p, pie }: { p: Prod; pie: Mat }) {
  return (
    <section className="panel space-y-3">
      <h2 className="panel-titulo">Falta cargar la tolva</h2>
      <Carga p={p} pie={pie} principal="Ya cargué" />
    </section>
  );
}

function Produciendo({ v, p }: { v: Vista; p: Prod }) {
  const golpesTurno = p.turnoAbierto?.golpesInicio ?? null;
  return (
    <>
      <section className="panel space-y-3">
        {p.contadorObjetivo != null ? (
          <p className="rounded-xl bg-[rgba(238,125,48,0.1)] p-4 text-center">
            <span className="block text-sm font-semibold text-foreground-muted">Terminá cuando el contador marque</span>
            <span className="font-[family-name:var(--font-display)] text-4xl font-bold text-[#b4521a]">{fmtNumero(p.contadorObjetivo, 0)}</span>
          </p>
        ) : (
          <p className="text-sm text-foreground-muted">Sin cantidad objetivo: consultá con el Encargado cuándo terminar.</p>
        )}
        <p className="text-sm text-foreground-muted">
          {p.ultimoTurno ? (
            <>
              Al cierre del turno anterior: <b className="text-foreground">{fmtNumero(p.producido, 0)}</b>
              {p.objetivo != null ? ` de ${fmtNumero(p.objetivo, 0)}` : ""} piezas.
            </>
          ) : (
            "El avance se ve al cerrar el turno (los golpes se cargan al cierre)."
          )}
        </p>
        {p.ultimaCarga && <p className="text-sm font-semibold text-[var(--estado-ok-fg)]">✓ Última carga registrada a las {fmtHora(p.ultimaCarga)}.</p>}
        <Materiales titulo="A pie de máquina" lista={v.pie} vacio="No queda material a pie de máquina." />
        <DespuesSigue t={v.asignadas[0]} />
      </section>
      <section className="panel space-y-3">
        {/* En producción, la carga es una acción más: sus opciones aparecen sólo si no alcanza. */}
        <Carga p={p} pie={v.pie} principal="Cargué otra vez" secundarias={false} />
      </section>
      <section className="panel">
        <Opciones
          opciones={[
            {
              id: "terminar",
              label: "Terminar producción",
              fuerte: true,
              contenido: <FormTerminar p={p} />,
            },
            {
              id: "pausar",
              label: "Pausar",
              contenido: (
                <FormAccion accion={pausarAction} ocultos={{ cicloId: p.cicloId }} boton="Pausar" claseBoton="btn btn-azul btn-block" className="space-y-2">
                  <select name="motivo" required defaultValue="" className="input">
                    <option value="" disabled>
                      Motivo…
                    </option>
                    {MOTIVOS_NO_CARGA.map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </FormAccion>
              ),
            },
            {
              id: "turno",
              label: "Cerrar mi turno",
              contenido: (
                <FormAccion accion={cerrarTurnoAction} ocultos={{ cicloId: p.cicloId }} boton="Cerrar mi turno y dejar relevo" claseBoton="btn btn-azul btn-lg btn-block" className="space-y-3">
                  <CamposCierre golpesDesde={golpesTurno} piezasPorGolpe={p.piezasPorGolpe} textoStock="Buenas del turno" />
                  <label className="campo">
                    <span>Indicaciones para el que entra (opcional)</span>
                    <input name="observaciones" className="input" />
                  </label>
                </FormAccion>
              ),
            },
          ]}
        />
      </section>
    </>
  );
}

async function FormTerminar({ p }: { p: Prod }) {
  const sobrantes = await codigosDeSobrante();
  return (
    <FormAccion
      accion={cerrarProduccionTallerAction}
      ocultos={{ cicloId: p.cicloId }}
      boton="Terminar producción"
      claseBoton="btn btn-primary btn-lg btn-block"
      confirmar="¿Terminar la producción? Lo producido entra a stock y la tanda queda completada."
      className="space-y-3"
    >
      <CamposCierre golpesDesde={p.golpesInicioProduccion} piezasPorGolpe={p.piezasPorGolpe} descartePrevio={p.descartePiezas} textoStock="A stock" />
      {/* Hasta que exista la aprobación del Encargado, estos datos se siguen cargando acá (opcionales). */}
      <details className="rounded-xl border border-border p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Más datos del cierre (opcional)</summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <label className="campo">
            <span>Rebarba (kg)</span>
            <input name="rebarbaKg" inputMode="decimal" className="input" />
          </label>
          <label className="campo">
            <span>Scrap (kg)</span>
            <input name="scrapKg" inputMode="decimal" className="input" />
          </label>
          <label className="campo">
            <span>Sobrante bajado de tolva (kg)</span>
            <input name="sobranteKg" inputMode="decimal" className="input" />
          </label>
          <label className="campo">
            <span>Código del sobrante</span>
            <select name="sobranteMpId" defaultValue="" className="input">
              <option value="">—</option>
              {sobrantes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
    </FormAccion>
  );
}
