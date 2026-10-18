"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moverTandaCalendarioAction } from "@/app/actions/planificacion";

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
  enCurso: boolean;
};

const TURNOS = [
  { valor: "MANANA", etiqueta: "Mañana" },
  { valor: "TARDE", etiqueta: "Tarde" },
  { valor: "NOCHE", etiqueta: "Noche" },
] as const;

const fmtDia = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });

/**
 * Planificación por día y turno: cada tanda es una tarjeta que se arrastra con
 * el mouse a otra casilla (día × turno). El cambio se guarda en el servidor y
 * se ve igual al recargar. En el celular, cada tarjeta tiene «Mover a…».
 */
export function CalendarioPlan({ dias, tarjetas, editable }: { dias: string[]; tarjetas: TarjetaCal[]; editable: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const [lista, mover] = useOptimistic(tarjetas, (actual, m: { id: number; fecha: string | null; turno: TarjetaCal["turno"] }) =>
    actual.map((t) => (t.id === m.id ? { ...t, fecha: m.fecha, turno: m.turno } : t)),
  );
  const [sobre, setSobre] = useState<string | null>(null);

  const soltar = (id: number, fecha: string | null, turno: TarjetaCal["turno"]) => {
    const t = lista.find((x) => x.id === id);
    if (!t || t.enCurso || (t.fecha === fecha && t.turno === turno)) return;
    setError(null);
    start(async () => {
      mover({ id, fecha, turno });
      const r = await moverTandaCalendarioAction(id, fecha, turno);
      if (r.error) setError(r.error);
      router.refresh();
    });
  };

  const casilla = (fecha: string | null, turno: TarjetaCal["turno"]) => {
    const clave = `${fecha ?? "-"}|${turno ?? "-"}`;
    const enCasilla = lista.filter((t) => (fecha == null ? t.fecha == null || t.turno == null : t.fecha === fecha && t.turno === turno));
    return (
      <div
        key={clave}
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          setSobre(clave);
        }}
        onDragLeave={() => setSobre((s) => (s === clave ? null : s))}
        onDrop={(e) => {
          e.preventDefault();
          setSobre(null);
          const id = Number(e.dataTransfer.getData("text/plain"));
          if (id) soltar(id, fecha, fecha == null ? null : turno);
        }}
        className={`min-h-24 space-y-1.5 rounded-lg border p-1.5 transition-colors ${sobre === clave ? "border-accent bg-[rgba(238,125,48,0.08)]" : "border-dashed border-border bg-surface-muted/60"}`}
        aria-label={fecha ? `${fmtDia(fecha)} · turno ${TURNOS.find((x) => x.valor === turno)?.etiqueta}` : "Sin día asignado"}
      >
        {enCasilla.map((t) => (
          <Tarjeta key={t.id} t={t} dias={dias} editable={editable} onMover={soltar} />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {error && <p className="aviso aviso-error">{error}</p>}
      <div className="overflow-x-auto">
        <div className="grid min-w-[980px] gap-2" style={{ gridTemplateColumns: `5.5rem repeat(${dias.length}, minmax(0, 1fr))` }}>
          <div />
          {dias.map((d) => (
            <div key={d} className="text-center text-xs font-bold uppercase tracking-wide text-foreground-muted">
              {fmtDia(d)}
            </div>
          ))}
          {TURNOS.map((tu) => (
            <div key={tu.valor} className="contents">
              <div className="flex items-center text-sm font-semibold text-brand-azul">{tu.etiqueta}</div>
              {dias.map((d) => casilla(d, tu.valor))}
            </div>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-bold uppercase tracking-wide text-foreground-muted">Sin día o turno asignado (arrastrá desde o hacia acá)</div>
        {casilla(null, null)}
      </div>
    </div>
  );
}

function Tarjeta({ t, dias, editable, onMover }: { t: TarjetaCal; dias: string[]; editable: boolean; onMover: (id: number, f: string | null, tu: TarjetaCal["turno"]) => void }) {
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
      <div className="mt-1 font-[family-name:var(--font-display)] text-sm font-bold">{t.cantidad.toLocaleString("es-AR")} u.</div>
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
        {t.inyectora && <span className="badge-estado badge-info px-1.5 py-0 text-[10px]">Iny. {t.inyectora}</span>}
      </div>
      {movible && (
        <button type="button" className="mt-1 text-[11px] font-semibold text-accent" onClick={() => setAbierto((x) => !x)}>
          Mover a…
        </button>
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
