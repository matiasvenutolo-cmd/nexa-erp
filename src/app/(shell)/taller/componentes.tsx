"use client";

import { useEffect, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { BOLSAS_MAX_POR_CARGA, fmtCantidadBolsas, fmtPeso, fmtPresentacion, kgDe } from "@/lib/presentaciones";

export type ItemCarga = { materiaPrimaId: number; presentacionId: number; nombre: string; presentacion: string; kgPres: number; cantidad: number; esMaster: boolean; enPie: number };

/** Cookie con la máquina del operario: el celular la recuerda al volver a entrar. */
export const COOKIE_MAQUINA = "nexa_maquina";

export function RecordarMaquina({ iny }: { iny: string }) {
  useEffect(() => {
    document.cookie = `${COOKIE_MAQUINA}=${iny}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }, [iny]);
  return null;
}

/**
 * «Cargué distinto»: la receta precargada en bolsas, con + / − (medias
 * bolsas) y sin pasar de lo que hay a pie de máquina. Pide el motivo. El
 * material sale siempre del pie de máquina (Cambios en Producción, nov. 2026).
 */
export function CargaDistinta({ items, motivos }: { items: ItemCarga[]; motivos: readonly string[] }) {
  // Lo máximo que se puede cargar de cada renglón: lo que hay a pie de máquina, en medias bolsas.
  const maximo = items.map((i) => (i.kgPres > 0 ? Math.floor((i.enPie / i.kgPres) * 2 + 1e-6) / 2 : 0));
  const [cant, setCant] = useState(() => items.map((i, k) => Math.min(i.cantidad, maximo[k])));
  // El mezclador lleva hasta 4 bolsas por carga, sin contar el master (reunión 20/11/2026).
  const bolsas = items.reduce((t, i, k) => t + (i.esMaster ? 0 : cant[k]), 0);
  const tope = (k: number) => (items[k].esMaster ? maximo[k] : Math.min(maximo[k], cant[k] + Math.max(0, BOLSAS_MAX_POR_CARGA - bolsas)));
  const cambiar = (k: number, d: number) => setCant((c) => c.map((v, j) => (j === k ? Math.min(tope(k), Math.max(0, Math.round((v + d) * 2) / 2)) : v)));
  return (
    <div className="space-y-3">
      <input type="hidden" name="ajustes" value={JSON.stringify(items.map((i, k) => ({ materiaPrimaId: i.materiaPrimaId, presentacionId: i.presentacionId, cantidad: cant[k] })))} />
      <ul className="space-y-2">
        {items.map((i, k) => (
          <li key={`${i.materiaPrimaId}-${i.presentacionId}`} className="rounded-xl border border-border bg-white p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-semibold">{i.nombre}</span>
                <span className="block text-xs text-foreground-muted">
                  Receta: {fmtPresentacion(i.cantidad, i.presentacion)} · a pie de máquina: {fmtPeso(i.enPie, { gramos: i.esMaster })}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <button type="button" className="btn btn-outline btn-paso" onClick={() => cambiar(k, -0.5)} aria-label="Media bolsa menos">
                  <Minus size={18} />
                </button>
                <span className="w-12 text-center font-[family-name:var(--font-display)] text-xl font-bold">{fmtCantidadBolsas(cant[k])}</span>
                <button type="button" className="btn btn-outline btn-paso" onClick={() => cambiar(k, 0.5)} disabled={cant[k] >= tope(k)} aria-label="Media bolsa más">
                  <Plus size={18} />
                </button>
              </span>
            </div>
            <div className="mt-1 text-right text-xs text-foreground-muted">{fmtPeso(kgDe(cant[k], i.kgPres), { gramos: i.esMaster })}</div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-foreground-muted">Hasta {BOLSAS_MAX_POR_CARGA} bolsas por carga (lo que entra en el mezclador), más el master.</p>
      <label className="campo">
        <span>¿Por qué cargaste distinto?</span>
        <select name="motivo" required defaultValue="" className="input">
          <option value="" disabled>
            Elegí el motivo…
          </option>
          {motivos.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * Recepción del relevo: lo normal es «Recibí la máquina». Lo que se puede
 * contar son las bolsas a pie de máquina; si faltan, se marca con el motivo y
 * le llega al Encargado. La tolva no se verifica a ojo: no se pregunta.
 */
export function FaltaMaterialRelevo({ motivos }: { motivos: readonly string[] }) {
  const [falta, setFalta] = useState(false);
  return (
    <div className="space-y-2">
      <input type="hidden" name="recepcion" value={falta ? "diferencia" : "ok"} />
      <button type="button" onClick={() => setFalta((x) => !x)} className={`btn btn-sm ${falta ? "btn-azul" : "btn-outline"}`}>
        Falta material a pie de máquina
      </button>
      {falta && (
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

/** Botones grandes de turno (sólo cuando hay superposición o no hay esquema cargado). */
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
 * Opciones secundarias de un estado: botones que despliegan su formulario de
 * a uno. `fuerte` pinta el botón (ej. «Terminar producción»).
 */
export function Opciones({ opciones }: { opciones: { id: string; label: string; fuerte?: boolean; contenido: React.ReactNode }[] }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const actual = opciones.find((o) => o.id === abierto);
  return (
    <div className="space-y-3">
      <div className={`grid gap-2 ${opciones.length > 1 ? "grid-cols-2" : ""}`}>
        {opciones.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setAbierto(abierto === o.id ? null : o.id)}
            className={`btn ${o.fuerte ? "btn-primary col-span-2" : abierto === o.id ? "btn-azul" : "btn-outline"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {actual && <div className="rounded-xl border border-border p-3">{actual.contenido}</div>}
    </div>
  );
}

/**
 * Golpes y descarte al cerrar el turno o terminar, con el resultado a la
 * vista antes de confirmar: «Producidas 400 · Descarte 6 · A stock 394».
 */
export function CamposCierre({
  golpesDesde,
  piezasPorGolpe,
  descartePrevio = 0,
  piezasPrevias = 0,
  textoStock,
}: {
  /** Golpes desde los que se cuentan las piezas (inicio del turno o de la producción). */
  golpesDesde: number | null;
  piezasPorGolpe: number;
  /** Al terminar: descarte de los turnos ya cerrados. */
  descartePrevio?: number;
  piezasPrevias?: number;
  /** «A stock» al terminar; «del turno» al cerrar el turno. */
  textoStock: string;
}) {
  const [golpes, setGolpes] = useState("");
  const [descarte, setDescarte] = useState("");
  const g = golpes.trim() === "" ? null : Number(golpes);
  const d = descarte.trim() === "" ? 0 : Number(descarte);
  const producidas = g != null && Number.isFinite(g) && golpesDesde != null ? Math.max(0, (g - golpesDesde) * piezasPorGolpe) + piezasPrevias : null;
  const descTotal = Number.isFinite(d) ? d + descartePrevio : null;
  return (
    <div className="space-y-3">
      <label className="campo">
        <span>Golpes que marca la máquina</span>
        <input name="golpesFin" inputMode="numeric" required className="input text-lg" value={golpes} onChange={(e) => setGolpes(e.target.value)} />
      </label>
      <label className="campo">
        <span>Piezas descartadas{descartePrevio || piezasPrevias ? " en tu turno" : ""}</span>
        <input name="descartePiezas" inputMode="numeric" placeholder="0" className="input text-lg" value={descarte} onChange={(e) => setDescarte(e.target.value)} />
      </label>
      {producidas != null && descTotal != null && (
        <p className="rounded-xl bg-surface-muted p-3 text-center font-semibold">
          Producidas {producidas.toLocaleString("es-AR")} · Descarte {descTotal.toLocaleString("es-AR")} · {textoStock} {Math.max(0, producidas - descTotal).toLocaleString("es-AR")}
        </p>
      )}
    </div>
  );
}
