"use client";

import { useState, useTransition } from "react";
import { Minus, Plus, ScanLine } from "lucide-react";
import { leerCodigoTallerAction } from "@/app/actions/taller";
import { fmtCantidadBolsas, fmtPeso, kgDe } from "@/lib/presentaciones";

export type ItemCarga = { materiaPrimaId: number; presentacionId: number; nombre: string; presentacion: string; kgPres: number; cantidad: number; esMaster: boolean };

/** Cantidades con + / − (medias bolsas). Deja el JSON en un campo oculto. */
export function CantidadesCarga({ items }: { items: ItemCarga[] }) {
  const [cant, setCant] = useState(() => items.map((i) => i.cantidad));
  const cambiar = (k: number, d: number) => setCant((c) => c.map((v, j) => (j === k ? Math.max(0, Math.round((v + d) * 2) / 2) : v)));
  return (
    <div className="space-y-2">
      <input
        type="hidden"
        name="ajustes"
        value={JSON.stringify(items.map((i, k) => ({ materiaPrimaId: i.materiaPrimaId, presentacionId: i.presentacionId, cantidad: cant[k] })))}
      />
      {items.map((i, k) => (
        <div key={`${i.materiaPrimaId}-${i.presentacionId}`} className="flex items-center gap-3 rounded-xl border border-border bg-white p-2.5">
          <button type="button" className="btn btn-outline btn-paso" onClick={() => cambiar(k, -0.5)} aria-label={`Media ${i.presentacion} menos`}>
            <Minus size={20} />
          </button>
          <div className="min-w-0 flex-1 text-center">
            <div className="font-[family-name:var(--font-display)] text-2xl font-bold">{fmtCantidadBolsas(cant[k])}</div>
            <div className="truncate text-xs text-foreground-muted">
              {i.presentacion} · {i.nombre}
            </div>
            <div className={`text-xs font-semibold ${cant[k] !== i.cantidad ? "text-accent" : "text-foreground-muted"}`}>
              = {fmtPeso(kgDe(cant[k], i.kgPres), { gramos: i.esMaster })} {cant[k] !== i.cantidad ? `(receta: ${fmtCantidadBolsas(i.cantidad)})` : ""}
            </div>
          </div>
          <button type="button" className="btn btn-outline btn-paso" onClick={() => cambiar(k, 0.5)} aria-label={`Media ${i.presentacion} más`}>
            <Plus size={20} />
          </button>
        </div>
      ))}
    </div>
  );
}

/** Lector del código de barras de la bolsa (o tipeado): confirma material y lote. */
export function LectorCodigo({ productoNumero, materialesReceta }: { productoNumero: string | null; materialesReceta: number[] }) {
  const [codigo, setCodigo] = useState("");
  const [res, setRes] = useState<{ ok: boolean; texto: string; detalle?: string } | null>(null);
  const [pendiente, start] = useTransition();
  const leer = () =>
    start(async () => {
      const r = await leerCodigoTallerAction(codigo, productoNumero);
      if (r.error || !r.dato) return setRes({ ok: false, texto: r.error ?? "No se pudo leer el código." });
      const d = r.dato;
      if (!d.lote) return setRes({ ok: false, texto: "El código no corresponde a un lote ingresado.", detalle: d.advertencias.join(" ") });
      const enReceta = materialesReceta.includes(d.lote.materiaPrimaId);
      setRes({
        ok: enReceta,
        texto: enReceta ? `Correcto: ${d.lote.materiaPrimaNombre}` : `Atención: ${d.lote.materiaPrimaNombre} no está en la receta de esta producción`,
        detalle: `Lote de MP ${d.lote.numeroLote}${d.certificado ? ` · certificado N° ${d.certificado.numero}` : " · sin certificado"}${d.advertencias.length ? ` · ${d.advertencias.join(" ")}` : ""}`,
      });
    });
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
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
          placeholder="Escaneá o escribí el código de la bolsa"
          className="input"
          aria-label="Código de barras de la bolsa"
        />
        <button type="button" className="btn btn-azul" onClick={leer} disabled={pendiente || codigo.replace(/\s/g, "").length < 27}>
          <ScanLine size={18} /> Leer
        </button>
      </div>
      {res && (
        <div className={`aviso ${res.ok ? "aviso-ok" : "aviso-alerta"}`}>
          <b>{res.texto}</b>
          {res.detalle && <div className="text-xs">{res.detalle}</div>}
        </div>
      )}
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

/** Botones grandes de turno (radio). */
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
