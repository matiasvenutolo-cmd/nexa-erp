"use client";

import { useState, useTransition } from "react";
import { Minus, Plus, ScanLine } from "lucide-react";
import { leerCodigoTallerAction } from "@/app/actions/taller";
import { fmtCantidadBolsas, fmtPeso, fmtPresentacion, kgDe } from "@/lib/presentaciones";

export type ItemCarga = { materiaPrimaId: number; presentacionId: number; nombre: string; presentacion: string; kgPres: number; cantidad: number; esMaster: boolean; enPie: number };

/**
 * Registrar carga en tolva de material a pie de máquina: la receta de la
 * producción viene precargada (en bolsas), cada material se tilda al cargarlo
 * y se ajusta con + / − (medias bolsas). Si algo cambia respecto de la receta,
 * pide el motivo. Por defecto el material sale del pie de máquina; destildando
 * «Uso de material a pie de máquina» se toma del stock general en el mismo paso.
 * La lectura del código de la bolsa es opcional.
 */
export function CargaTolva({ items, motivos, productoNumero }: { items: ItemCarga[]; motivos: readonly string[]; productoNumero: string | null }) {
  const [tildado, setTildado] = useState(() => items.map(() => true));
  const [cant, setCant] = useState(() => items.map((i) => i.cantidad));
  const [usarPie, setUsarPie] = useState(true);
  const [codigos, setCodigos] = useState<Record<number, string>>({});
  const efectiva = items.map((i, k) => (tildado[k] ? cant[k] : 0));
  const distinto = items.some((i, k) => efectiva[k] !== i.cantidad);
  const faltaPie = usarPie && items.some((i, k) => efectiva[k] > 0 && kgDe(efectiva[k], i.kgPres) > i.enPie + 1e-6);
  const cambiar = (k: number, d: number) => setCant((c) => c.map((v, j) => (j === k ? Math.max(0, Math.round((v + d) * 2) / 2) : v)));
  return (
    <div className="space-y-3">
      <input type="hidden" name="ajustes" value={distinto ? JSON.stringify(items.map((i, k) => ({ materiaPrimaId: i.materiaPrimaId, presentacionId: i.presentacionId, cantidad: efectiva[k] }))) : ""} />
      <input type="hidden" name="usarPie" value={usarPie ? "1" : "0"} />
      <input type="hidden" name="codigos" value={JSON.stringify(Object.entries(codigos).filter(([, c]) => c).map(([id, codigo]) => ({ materiaPrimaId: Number(id), codigo })))} />

      <label className="flex items-start gap-3 rounded-xl border border-border bg-surface-muted p-3">
        <input type="checkbox" checked={usarPie} onChange={(e) => setUsarPie(e.target.checked)} className="mt-0.5 h-5 w-5" />
        <span>
          <span className="block font-semibold">Uso de material a pie de máquina</span>
          <span className="block text-xs text-foreground-muted">
            {usarPie
              ? "El material sale de lo que está junto a la máquina."
              : "Destildado: el material se retira del stock general (queda registrado a tu nombre) y se carga en la tolva en el mismo paso."}
          </span>
        </span>
      </label>

      <ul className="space-y-2">
        {items.map((i, k) => (
          <li key={`${i.materiaPrimaId}-${i.presentacionId}`} className={`rounded-xl border p-2.5 ${tildado[k] ? "border-[var(--estado-ok-fg)] bg-white" : "border-border bg-surface-muted"}`}>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={tildado[k]} onChange={(e) => setTildado((t) => t.map((v, j) => (j === k ? e.target.checked : v)))} className="h-6 w-6" aria-label={`Cargué ${i.nombre}`} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{i.nombre}</span>
                <span className="block text-sm">
                  {fmtPeso(kgDe(efectiva[k], i.kgPres), { gramos: i.esMaster })} ({fmtPresentacion(efectiva[k], i.presentacion)})
                </span>
                {usarPie && <span className={`block text-xs ${i.enPie + 1e-6 < kgDe(efectiva[k], i.kgPres) ? "font-semibold text-[var(--estado-critico-fg)]" : "text-foreground-muted"}`}>A pie de máquina: {fmtPeso(i.enPie, { gramos: i.esMaster })}</span>}
              </span>
            </label>
            {tildado[k] && (
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <button type="button" className="btn btn-outline btn-paso" onClick={() => cambiar(k, -0.5)} aria-label="Media bolsa menos">
                    <Minus size={18} />
                  </button>
                  <span className="w-14 text-center font-[family-name:var(--font-display)] text-xl font-bold">{fmtCantidadBolsas(cant[k])}</span>
                  <button type="button" className="btn btn-outline btn-paso" onClick={() => cambiar(k, 0.5)} aria-label="Media bolsa más">
                    <Plus size={18} />
                  </button>
                </div>
                <LectorCodigo productoNumero={productoNumero} materialId={i.materiaPrimaId} onCodigo={(c) => setCodigos((x) => ({ ...x, [i.materiaPrimaId]: c }))} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {faltaPie && <p className="aviso aviso-alerta text-sm">No alcanza lo que hay a pie de máquina: destildá «Uso de material a pie de máquina» para tomarlo del stock general, o cargá lo que hay indicando el motivo.</p>}
      {distinto && (
        <label className="campo">
          <span>Cargaste distinto de la receta: ¿por qué?</span>
          <select name="motivo" required defaultValue="" className="input">
            <option value="" disabled>
              Elegí el motivo…
            </option>
            {motivos.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Lectura opcional del código de la bolsa: confirma que sea de ese material. */
export function LectorCodigo({ productoNumero, materialId, onCodigo }: { productoNumero: string | null; materialId: number; onCodigo: (codigo: string) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [res, setRes] = useState<{ ok: boolean; texto: string } | null>(null);
  const [pendiente, start] = useTransition();
  const leer = () =>
    start(async () => {
      const r = await leerCodigoTallerAction(codigo, productoNumero);
      if (r.error || !r.dato?.lote) {
        setRes({ ok: false, texto: r.error ?? "El código no corresponde a un lote ingresado." });
        onCodigo("");
        return;
      }
      const ok = r.dato.lote.materiaPrimaId === materialId;
      setRes({ ok, texto: ok ? `Lote ${r.dato.lote.numeroLote}${r.dato.certificado ? ` · cert. N° ${r.dato.certificado.numero}` : ""}` : `Es ${r.dato.lote.materiaPrimaNombre}, no este material` });
      onCodigo(ok ? r.dato.codigo : "");
    });
  if (!abierto) {
    return (
      <button type="button" onClick={() => setAbierto(true)} className="btn btn-ghost btn-sm">
        <ScanLine size={16} /> Leer bolsa (opcional)
      </button>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              leer();
            }
          }}
          inputMode="numeric"
          placeholder="Código de la bolsa"
          className="input w-44 py-1 text-xs"
          aria-label="Código de barras de la bolsa"
          autoFocus
        />
        <button type="button" className="btn btn-azul btn-sm" disabled={pendiente || codigo.replace(/\s/g, "").length < 27} onClick={leer}>
          Leer
        </button>
      </div>
      {res && <span className={`text-xs font-semibold ${res.ok ? "text-[var(--estado-ok-fg)]" : "text-[var(--estado-critico-fg)]"}`}>{res.texto}</span>}
    </div>
  );
}

/** Recepción del relevo: coincide o hay diferencia (con motivo de la lista). */
export function RecepcionRelevo({ motivos }: { motivos: readonly string[] }) {
  const [valor, setValor] = useState<"ok" | "diferencia" | "">("");
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className={`btn btn-lg ${valor === "ok" ? "btn-azul" : "btn-outline"}`}>
          <input type="radio" name="recepcion" value="ok" className="sr-only" checked={valor === "ok"} onChange={() => setValor("ok")} required />
          Coincide
        </label>
        <label className={`btn btn-lg ${valor === "diferencia" ? "btn-primary" : "btn-outline"}`}>
          <input type="radio" name="recepcion" value="diferencia" className="sr-only" checked={valor === "diferencia"} onChange={() => setValor("diferencia")} />
          Hay diferencia
        </label>
      </div>
      {valor === "diferencia" && (
        <div className="space-y-2">
          <select name="recepcionMotivo" required defaultValue="" className="input">
            <option value="" disabled>
              ¿Qué pasa?
            </option>
            {motivos.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </select>
          <input name="recepcionDetalle" placeholder="Detalle (ej. falta una bolsita de master)" className="input" />
        </div>
      )}
    </div>
  );
}

/** Botones grandes de turno (sólo si los horarios no están configurados). */
export function ElegirTurno({ turnos, sugerido }: { turnos: { valor: string; etiqueta: string }[]; sugerido?: string | null }) {
  const [valor, setValor] = useState(sugerido ?? "");
  return (
    <div className="grid grid-cols-3 gap-2">
      {turnos.map((t) => (
        <label key={t.valor} className={`btn btn-lg ${valor === t.valor ? "btn-azul" : "btn-outline"}`}>
          <input type="radio" name="turno" value={t.valor} className="sr-only" checked={valor === t.valor} onChange={() => setValor(t.valor)} required />
          {t.etiqueta}
        </label>
      ))}
    </div>
  );
}

/**
 * Cierre con dos botones claros: «Cerrar mi turno y dejar relevo» y
 * «Finalizar producción». Al elegir uno se despliegan sólo sus campos.
 */
export function DosBotonesCierre({ relevo, finalizar }: { relevo: React.ReactNode; finalizar: React.ReactNode }) {
  const [abierto, setAbierto] = useState<"relevo" | "fin" | null>(null);
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => setAbierto(abierto === "relevo" ? null : "relevo")} className={`btn btn-lg ${abierto === "relevo" ? "btn-azul" : "btn-outline"}`}>
          Cerrar mi turno y dejar relevo
        </button>
        <button type="button" onClick={() => setAbierto(abierto === "fin" ? null : "fin")} className={`btn btn-lg ${abierto === "fin" ? "btn-primary" : "btn-outline"}`}>
          Finalizar producción
        </button>
      </div>
      {abierto === "relevo" && relevo}
      {abierto === "fin" && finalizar}
    </div>
  );
}
