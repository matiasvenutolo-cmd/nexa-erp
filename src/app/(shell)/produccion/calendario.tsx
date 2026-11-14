"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dividirYMoverAction, moverTandaAction, moverTandaCalendarioAction } from "@/app/actions/planificacion";
import { yaPaso } from "@/lib/turnos";

export type TarjetaCal = {
  id: number;
  fecha: string | null;
  turno: "MANANA" | "TARDE" | "NOCHE" | null;
  estado: string;
  color: string;
  hex: string | null;
  matriz: string;
  cantidad: number;
  material: string;
  prioridad: string | null;
  alerta: string | null;
  inyectora: string | null;
  esAccesorio: boolean;
  enCurso: boolean;
  /** Duración estimada (set-up + piezas ÷ piezas por hora); null sin datos. */
  duracionHoras: number | null;
};

const TURNOS = [
  { valor: "MANANA", etiqueta: "Mañana" },
  { valor: "TARDE", etiqueta: "Tarde" },
  { valor: "NOCHE", etiqueta: "Noche" },
] as const;

const fmtDia = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });

/** Trabajo de Matrices programado (cambio de matriz, reparación, service). */
export type TrabajoCal = { id: number; fecha: string; turno: TarjetaCal["turno"]; inyectora: string | null; texto: string; estado: string; duracionHoras: number | null; tandaId: number | null };

/** Horas de un turno (todas las ventanas duran 9 h). */
const HORAS_TURNO = 9;
const fmtHoras = (h: number) => (h > 0 && h < 0.1 ? "menos de 0,1 h" : `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(h)} h`);

/** Las máquinas de NEXA: baldosas siempre en la 8, accesorios en la 6. */
const MAQUINAS_BASE = ["8", "6"];
/** Columna de una tanda: su inyectora; sin asignar, la que le corresponde por tipo. */
const maquinaDe = (t: Pick<TarjetaCal, "inyectora" | "esAccesorio">) => t.inyectora ?? (t.esAccesorio ? "6" : "8");

/**
 * Planificación por día, turno y máquina (Cambios en Producción, nov. 2026):
 * cada día tiene una columna por inyectora, porque las máquinas trabajan en
 * paralelo. Cada tanda es una tarjeta que se arrastra con el mouse a otra
 * casilla (día × turno × máquina). El cambio se guarda en el servidor y se ve
 * igual al recargar. En el celular, cada tarjeta tiene «Mover a…».
 */

export function CalendarioPlan({ dias, tarjetas, editable, trabajos = [], esquemas = {} }: { dias: string[]; tarjetas: TarjetaCal[]; editable: boolean; trabajos?: TrabajoCal[]; esquemas?: Record<string, string> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Cuando una tanda no entra en el turno: propuesta de dividirla.
  const [propuesta, setPropuesta] = useState<{ id: number; piezas: number; fecha: string; turno: NonNullable<TarjetaCal["turno"]>; maquina: string | null } | null>(null);
  const [, start] = useTransition();
  const [lista, mover] = useOptimistic(tarjetas, (actual, m: { id: number; fecha: string | null; turno: TarjetaCal["turno"]; inyectora: string | null }) =>
    actual.map((t) => (t.id === m.id ? { ...t, fecha: m.fecha, turno: m.turno, inyectora: m.inyectora } : t)),
  );
  const [sobre, setSobre] = useState<string | null>(null);
  const maquinas = [
    ...MAQUINAS_BASE,
    ...[...new Set([...tarjetas.map(maquinaDe), ...trabajos.map((w) => w.inyectora).filter((x): x is string => Boolean(x))])].filter((m) => !MAQUINAS_BASE.includes(m)).sort((a, b) => Number(a) - Number(b)),
  ];

  /** `maquina` null = la bandeja sin día: la tanda conserva su máquina. */
  const soltar = (id: number, fecha: string | null, turno: TarjetaCal["turno"], maquina: string | null = null) => {
    const t = lista.find((x) => x.id === id);
    if (!t || t.enCurso) return;
    if (fecha && yaPaso(fecha, turno)) return setError("Ese día o turno ya pasó: elegí uno de hoy en adelante.");
    const inyectora = maquina ?? t.inyectora;
    if (t.fecha === fecha && t.turno === turno && maquinaDe({ ...t, inyectora }) === maquinaDe(t)) return;
    // Cada producto en su máquina: baldosas en la 8; accesorios fuera de la 8.
    if (maquina && maquina !== maquinaDe(t)) {
      if (!t.esAccesorio) return setError("Las baldosas se producen sólo en la inyectora 8.");
      if (maquina === "8") return setError("Los accesorios no van en la inyectora 8: es la de baldosas.");
    }
    setError(null);
    setPropuesta(null);
    start(async () => {
      mover({ id, fecha, turno, inyectora });
      const r = await moverTandaCalendarioAction(id, fecha, turno, maquina ?? undefined);
      if (r.error) setError(r.error);
      if (r.dividir && fecha && turno) setPropuesta({ id, piezas: r.dividir, fecha, turno, maquina });
      router.refresh();
    });
  };

  const dividir = () => {
    if (!propuesta) return;
    const p = propuesta;
    setError(null);
    setPropuesta(null);
    start(async () => {
      const r = await dividirYMoverAction(p.id, p.piezas, p.fecha, p.turno, p.maquina ?? undefined);
      if (r.error) setError(r.error);
      router.refresh();
    });
  };

  const ordenar = (id: number, direccion: "arriba" | "abajo") => {
    setError(null);
    start(async () => {
      const r = await moverTandaAction(id, direccion);
      if (r.error) setError(r.error);
      router.refresh();
    });
  };

  const casilla = (fecha: string | null, turno: TarjetaCal["turno"], maquina: string | null) => {
    const clave = `${fecha ?? "-"}|${turno ?? "-"}|${maquina ?? "-"}`;
    // Los días y turnos que ya pasaron no reciben tandas (reunión 10/11/2026).
    const pasado = fecha != null && yaPaso(fecha, turno);
    // Horas usadas: tandas + mantenimientos con duración (el cambio de matriz
    // de la planificación ya está en el set-up de la tanda).
    const horas =
      fecha == null
        ? 0
        : lista.filter((t) => t.fecha === fecha && t.turno === turno && maquinaDe(t) === maquina).reduce((h, t) => h + (t.duracionHoras ?? 0), 0) +
          trabajos.filter((w) => w.tandaId == null && w.fecha === fecha && w.turno === turno && (w.inyectora ?? maquinas[0]) === maquina).reduce((h, w) => h + (w.duracionHoras ?? 0), 0);
    const enCasilla = lista.filter((t) => (fecha == null ? t.fecha == null || t.turno == null : t.fecha === fecha && t.turno === turno && maquinaDe(t) === maquina));
    return (
      <div
        key={clave}
        onDragOver={(e) => {
          if (!editable || pasado) return;
          e.preventDefault();
          setSobre(clave);
        }}
        onDragLeave={() => setSobre((s) => (s === clave ? null : s))}
        onDrop={(e) => {
          e.preventDefault();
          setSobre(null);
          const id = Number(e.dataTransfer.getData("text/plain"));
          if (id) soltar(id, fecha, fecha == null ? null : turno, maquina);
        }}
        className={`min-h-24 space-y-1.5 rounded-lg border p-1.5 transition-colors ${pasado ? "border-transparent bg-[repeating-linear-gradient(45deg,rgba(29,43,58,0.04),rgba(29,43,58,0.04)_6px,transparent_6px,transparent_12px)]" : sobre === clave ? "border-accent bg-[rgba(238,125,48,0.08)]" : "border-dashed border-border bg-surface-muted/60"}`}
        aria-label={fecha ? `${fmtDia(fecha)} · turno ${TURNOS.find((x) => x.valor === turno)?.etiqueta} · inyectora ${maquina}` : "Sin día asignado"}
      >
        {horas > 0 && (
          <div className={`text-right text-[10px] font-semibold ${horas > HORAS_TURNO + 1e-9 ? "text-[var(--estado-critico-fg)]" : "text-foreground-muted"}`}>
            {fmtHoras(horas)} de {HORAS_TURNO} h
          </div>
        )}
        {fecha != null &&
          trabajos
            .filter((w) => w.fecha === fecha && w.turno === turno && (w.inyectora ?? maquinas[0]) === maquina)
            .map((w) => (
              <div key={`w${w.id}`} className="rounded-md border border-[var(--estado-bajo-fg)] bg-[var(--estado-bajo-bg)] px-1.5 py-1 text-[11px] font-semibold text-[var(--estado-bajo-fg)]" title="Programado por Matrices">
                🔧 {w.texto}
                {w.duracionHoras ? ` · ${fmtHoras(w.duracionHoras)}` : ""}
              </div>
            ))}
        {enCasilla.map((t, i) => (
          <Tarjeta key={t.id} t={t} dias={dias} editable={editable} onMover={soltar} onOrdenar={fecha != null && enCasilla.length > 1 ? { arriba: i > 0, abajo: i < enCasilla.length - 1, ordenar } : null} />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {error && (
        <div className="aviso aviso-error flex flex-wrap items-center justify-between gap-2">
          <span>{error}</span>
          {propuesta && (
            <button type="button" className="btn btn-primary btn-sm" onClick={dividir}>
              Dividir: dejar {propuesta.piezas} piezas acá y el resto sin día
            </button>
          )}
        </div>
      )}
      <div className="overflow-x-auto">
        <div
          className="grid gap-x-1 gap-y-2"
          style={{ gridTemplateColumns: `5.5rem repeat(${dias.length * maquinas.length}, minmax(8.5rem, 1fr))`, minWidth: `${5.5 + dias.length * maquinas.length * 8.8}rem` }}
        >
          <div />
          {dias.map((d) => (
            <div key={d} className="text-center text-xs font-bold uppercase tracking-wide text-foreground-muted" style={{ gridColumn: `span ${maquinas.length}` }}>
              {fmtDia(d)}
              {esquemas[d] && <div className="text-[10px] font-semibold normal-case text-brand-azul">esquema {esquemas[d].toLowerCase()}</div>}
              {trabajos
                .filter((w) => w.fecha === d && w.turno == null)
                .map((w) => (
                  <div key={`w${w.id}`} className="mt-0.5 rounded bg-[var(--estado-bajo-bg)] px-1 text-[10px] normal-case text-[var(--estado-bajo-fg)]" title="Programado por Matrices (sin turno)">
                    🔧 {w.texto}
                  </div>
                ))}
            </div>
          ))}
          <div />
          {dias.map((d) =>
            maquinas.map((m, i) => (
              <div key={`${d}-${m}`} className={`text-center text-[11px] font-semibold text-brand-azul ${i === 0 ? "" : "border-l border-border"}`}>
                Iny. {m}
                <span className="block text-[10px] font-normal text-foreground-muted">{m === "8" ? "baldosas" : m === "6" ? "accesorios" : ""}</span>
              </div>
            )),
          )}
          {TURNOS.map((tu) => (
            <div key={tu.valor} className="contents">
              <div className="flex items-center text-sm font-semibold text-brand-azul">{tu.etiqueta}</div>
              {dias.map((d) => maquinas.map((m) => casilla(d, tu.valor, m)))}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-foreground-muted">Sin día o turno asignado (arrastrá desde o hacia acá)</div>
        {casilla(null, null, null)}
      </div>
    </div>
  );
}

function Tarjeta({
  t,
  dias,
  editable,
  onMover,
  onOrdenar,
}: {
  t: TarjetaCal;
  dias: string[];
  editable: boolean;
  onMover: (id: number, f: string | null, tu: TarjetaCal["turno"]) => void;
  /** Orden dentro de la casilla (sólo si hay más de una tanda). */
  onOrdenar: { arriba: boolean; abajo: boolean; ordenar: (id: number, d: "arriba" | "abajo") => void } | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const movible = editable && !t.enCurso;
  return (
    <div
      draggable={movible}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(t.id));
        e.dataTransfer.effectAllowed = "move";
      }}
      className={`rounded-md border bg-white p-2 text-xs shadow-sm ${movible ? "cursor-grab active:cursor-grabbing" : ""} ${t.enCurso ? "border-[var(--estado-ok-fg)]" : t.estado === "POSTERGADA" ? "border-[var(--estado-bajo-fg)] opacity-80" : "border-border"}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="h-3.5 w-3.5 shrink-0 rounded-sm border border-[rgba(29,43,58,0.2)]" style={{ background: t.hex ?? "transparent" }} />
        <span className="truncate font-bold text-foreground">{t.color}</span>
      </div>
      <div className="truncate text-foreground-muted">{t.matriz}</div>
      <div className="mt-1 flex items-baseline justify-between gap-1">
        <span className="font-[family-name:var(--font-display)] text-sm font-bold">{t.cantidad.toLocaleString("es-AR")} u.</span>
        {t.duracionHoras != null && <span className="text-[10px] font-semibold text-foreground-muted">≈ {fmtHoras(t.duracionHoras)}</span>}
      </div>
      {t.material ? (
        <div className="line-clamp-2 text-[11px] text-foreground-muted" title={t.material}>
          {t.material}
        </div>
      ) : (
        <div className="text-[11px] italic text-[var(--estado-bajo-fg)]">Receta sin definir</div>
      )}
      <div className="mt-1 flex flex-wrap gap-1">
        {t.enCurso && <span className="badge-estado badge-ok px-1.5 py-0 text-[10px]">En producción</span>}
        {t.estado === "POSTERGADA" && <span className="badge-estado badge-bajo px-1.5 py-0 text-[10px]">Postergada</span>}
        {t.prioridad && <span className="badge-estado badge-naranja px-1.5 py-0 text-[10px]">{t.prioridad}</span>}
        {t.alerta && <span className="badge-estado badge-critico px-1.5 py-0 text-[10px]">{t.alerta}</span>}
        {!t.inyectora && <span className="badge-estado badge-bajo px-1.5 py-0 text-[10px]">Sin máquina</span>}
      </div>
      {movible && (
        <div className="mt-1 flex items-center justify-between gap-1">
          <button type="button" className="text-[11px] font-semibold text-accent" onClick={() => setAbierto((x) => !x)}>
            Mover a…
          </button>
          {onOrdenar && (
            <span className="flex gap-0.5">
              <button type="button" disabled={!onOrdenar.arriba} onClick={() => onOrdenar.ordenar(t.id, "arriba")} className="rounded px-1 text-xs font-bold text-brand-azul disabled:opacity-25" aria-label="Producir antes en el turno" title="Producir antes en el turno">
                ↑
              </button>
              <button type="button" disabled={!onOrdenar.abajo} onClick={() => onOrdenar.ordenar(t.id, "abajo")} className="rounded px-1 text-xs font-bold text-brand-azul disabled:opacity-25" aria-label="Producir después en el turno" title="Producir después en el turno">
                ↓
              </button>
            </span>
          )}
        </div>
      )}
      {abierto && (
        <form
          className="mt-1 space-y-1"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const f = String(fd.get("fecha") || "") || null;
            const tu = (String(fd.get("turno") || "") || null) as TarjetaCal["turno"];
            onMover(t.id, f, f ? tu : null);
            setAbierto(false);
          }}
        >
          <select name="fecha" defaultValue={t.fecha ?? ""} className="input py-1 text-[11px]">
            <option value="">Sin día</option>
            {dias.map((d) => (
              <option key={d} value={d}>
                {fmtDia(d)}
              </option>
            ))}
          </select>
          <select name="turno" defaultValue={t.turno ?? "MANANA"} className="input py-1 text-[11px]">
            {TURNOS.map((x) => (
              <option key={x.valor} value={x.valor}>
                {x.etiqueta}
              </option>
            ))}
          </select>
          <button className="btn btn-azul btn-sm w-full">Mover</button>
        </form>
      )}
    </div>
  );
}
