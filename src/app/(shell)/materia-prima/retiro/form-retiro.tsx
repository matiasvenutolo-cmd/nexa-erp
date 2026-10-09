"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { identificarCodigoAction, registrarRetiroAction, type EstadoMaquina } from "@/app/actions/maquina";
import { INYECTORAS } from "@/lib/inyectoras";
import { fmtNumero } from "@/lib/format";

export type CicloRetiro = {
  id: number;
  etiqueta: string;
  productoNumero: string | null;
  kgPorPieza: number | null;
  gPorKgMp: number | null;
  materialBaseId: number | null;
  masterMpId: number | null;
};
type Mp = { id: number; nombre: string; tipo: string };
type Lote = { id: number; codigoBarra: string; numeroLote: string; materiaPrimaId: number; disponible: number };
type Persona = { id: number; nombre: string };
type Linea = { key: number; materiaPrimaId: string; loteMpId: string; cantidadKg: string; codigoLeido: string | null };

let k = 1;
const nueva = (over: Partial<Linea> = {}): Linea => ({ key: k++, materiaPrimaId: "", loteMpId: "", cantidadKg: "", codigoLeido: null, ...over });
const token = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function FormRetiroMaquina({
  ciclos,
  materias,
  lotes,
  responsables,
  entregan,
  cicloInicial,
}: {
  ciclos: CicloRetiro[];
  materias: Mp[];
  lotes: Lote[];
  responsables: Persona[];
  entregan: Persona[];
  cicloInicial: number | null;
}) {
  const [state, action, pendiente] = useActionState<EstadoMaquina, FormData>(registrarRetiroAction, {});
  const [tok] = useState(token);
  const [cicloId, setCicloId] = useState(cicloInicial && ciclos.some((c) => c.id === cicloInicial) ? String(cicloInicial) : "");
  const ciclo = ciclos.find((c) => String(c.id) === cicloId) ?? null;
  const [piezas, setPiezas] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([nueva()]);
  const [codigo, setCodigo] = useState("");
  const [lectura, setLectura] = useState<{ error?: string; aviso?: string } | null>(null);
  const [leyendo, startLectura] = useTransition();

  const upd = (key: number, patch: Partial<Linea>) => setLineas((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const tipoDe = (id: string) => materias.find((m) => String(m.id) === id)?.tipo;

  // Necesidad y rendimiento estimados con los datos configurados (nada inventado).
  const calculo = useMemo(() => {
    const kg = ciclo?.kgPorPieza ?? null;
    const virgen = lineas.filter((l) => l.materiaPrimaId && tipoDe(l.materiaPrimaId) !== "MASTER").reduce((t, l) => t + (Number(l.cantidadKg) || 0), 0);
    const master = lineas.filter((l) => l.materiaPrimaId && tipoDe(l.materiaPrimaId) === "MASTER").reduce((t, l) => t + (Number(l.cantidadKg) || 0), 0);
    const pzs = Number(piezas) || 0;
    return {
      kg,
      virgen,
      master,
      mpNecesaria: kg && pzs ? pzs * kg : null,
      masterNecesarioG: kg && pzs && ciclo?.gPorKgMp ? pzs * kg * ciclo.gPorKgMp : null,
      piezasEstimadas: kg && virgen ? Math.floor((virgen + master) / kg) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ciclo, lineas, piezas]);

  function sugerir() {
    if (!ciclo) return;
    const extra: Linea[] = [];
    const pzs = Number(piezas) || 0;
    const kg = ciclo.kgPorPieza;
    if (ciclo.materialBaseId && !lineas.some((l) => l.materiaPrimaId === String(ciclo.materialBaseId))) {
      extra.push(nueva({ materiaPrimaId: String(ciclo.materialBaseId), cantidadKg: kg && pzs ? String(Math.round(pzs * kg * 1000) / 1000) : "" }));
    }
    if (ciclo.masterMpId && !lineas.some((l) => l.materiaPrimaId === String(ciclo.masterMpId))) {
      extra.push(nueva({ materiaPrimaId: String(ciclo.masterMpId) }));
    }
    setLineas((xs) => [...xs.filter((x) => x.materiaPrimaId), ...extra]);
  }

  function leer() {
    const c = codigo.trim();
    if (!c) return;
    startLectura(async () => {
      const r = await identificarCodigoAction(c, ciclo?.productoNumero ?? null);
      if (r.error || !r.dato) {
        setLectura({ error: r.error ?? "No se pudo leer el código." });
        return;
      }
      const d = r.dato;
      if (d.lote && lineas.some((l) => l.loteMpId === String(d.lote!.id))) {
        setLectura({ error: `El lote ${d.lote.numeroLote} ya está en el retiro (doble lectura).` });
        return;
      }
      const fila = d.lote
        ? nueva({ materiaPrimaId: String(d.lote.materiaPrimaId), loteMpId: String(d.lote.id), codigoLeido: d.codigo })
        : nueva({ codigoLeido: null });
      setLineas((xs) => [...xs.filter((x) => x.materiaPrimaId), fila]);
      setLectura({
        aviso: [
          d.lote ? `${d.lote.materiaPrimaNombre} · lote ${d.lote.numeroLote} · ${fmtNumero(d.disponibleKg, 3)} kg disponibles` : null,
          d.certificado ? `certificado N° ${d.certificado.numero} (${d.certificado.proveedor})` : null,
          ...d.advertencias,
        ]
          .filter(Boolean)
          .join(" · "),
      });
      setCodigo("");
    });
  }

  const lineasJson = JSON.stringify(
    lineas
      .filter((l) => l.materiaPrimaId && Number(l.cantidadKg) > 0)
      .map((l) => ({ materiaPrimaId: Number(l.materiaPrimaId), loteMpId: l.loteMpId ? Number(l.loteMpId) : null, cantidadKg: Number(l.cantidadKg), codigoLeido: l.codigoLeido })),
  );

  return (
    <form action={action} className="space-y-5 rounded-lg border border-border bg-surface p-4">
      {state.error && (
        <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">{state.error}</div>
      )}
      <input type="hidden" name="token" value={tok} />
      <input type="hidden" name="lineas" value={lineasJson} />

      <section className="grid gap-3 sm:grid-cols-2">
        <Campo label="Ciclo de producción">
          <select name="cicloId" value={cicloId} onChange={(e) => setCicloId(e.target.value)} className="input">
            <option value="">Sin ciclo (otro uso)</option>
            {ciclos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.etiqueta}
              </option>
            ))}
          </select>
        </Campo>
        {ciclo ? (
          <Campo label="Inyectora">
            <input className="input bg-surface-muted" readOnly value="La del ciclo" />
          </Campo>
        ) : (
          <Campo label="Inyectora *">
            <select name="inyectora" required defaultValue="" className="input">
              <option value="" disabled>
                Elegí…
              </option>
              {INYECTORAS.map((n) => (
                <option key={n} value={n}>
                  Inyectora {n}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <Campo label="Operario responsable">
          <select name="operarioId" defaultValue="" className="input">
            <option value="">—</option>
            {responsables.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Entrega (depósito)">
          <select name="entregaId" defaultValue="" className="input">
            <option value="">—</option>
            {entregan.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </Campo>
      </section>
      {ciclos.length === 0 && (
        <p className="text-xs text-foreground-muted">No hay ciclos en curso. Para vincular el material a una producción, primero iniciá el ciclo en Producción.</p>
      )}

      <section className="space-y-2 rounded-md border border-border p-3">
        <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
          <Campo label="Piezas previstas">
            <input name="piezasPrevistas" type="number" min={1} className="input" value={piezas} onChange={(e) => setPiezas(e.target.value)} />
          </Campo>
          <div className="text-xs text-foreground-muted sm:pt-6">
            {!ciclo ? (
              "Elegí el ciclo para calcular el material necesario."
            ) : calculo.kg == null ? (
              "El producto no tiene peso por pieza configurado (Panel Admin → Productos): no se puede calcular el material necesario."
            ) : (
              <>
                {calculo.mpNecesaria != null && <>Material necesario: {fmtNumero(calculo.mpNecesaria, 2)} kg</>}
                {calculo.masterNecesarioG != null && <> · master: {fmtNumero(calculo.masterNecesarioG, 3)} g (dosificación configurada)</>}
                {calculo.piezasEstimadas != null && <> · con lo cargado abajo salen ≈ {fmtNumero(calculo.piezasEstimadas, 0)} piezas</>}
              </>
            )}
          </div>
        </div>
        {ciclo && (ciclo.materialBaseId || ciclo.masterMpId) && (
          <button type="button" onClick={sugerir} className="text-xs font-medium text-accent hover:underline">
            Agregar el material base y el master configurados para este producto
          </button>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-end gap-2 rounded-md bg-surface-muted p-3">
          <Campo label="Leer código de barras (27 dígitos)">
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  leer();
                }
              }}
              className="input w-80 font-mono"
              placeholder="000…"
              inputMode="numeric"
            />
          </Campo>
          <button type="button" onClick={leer} disabled={leyendo} className="rounded-md bg-surface px-3 py-2 text-sm font-medium">
            Identificar
          </button>
          {lectura?.error && <p className="w-full text-xs text-[var(--estado-critico-fg)]">{lectura.error}</p>}
          {lectura?.aviso && <p className="w-full text-xs text-foreground-muted">{lectura.aviso}</p>}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-foreground-muted">
              <th className="py-1.5">Material</th>
              <th className="py-1.5">Lote de MP</th>
              <th className="py-1.5">Kg</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lineas.map((l) => {
              const lotesMp = lotes.filter((x) => String(x.materiaPrimaId) === l.materiaPrimaId);
              return (
                <tr key={l.key} className="align-top">
                  <td className="py-1 pr-2">
                    <select
                      aria-label="Materia prima"
                      value={l.materiaPrimaId}
                      onChange={(e) => upd(l.key, { materiaPrimaId: e.target.value, loteMpId: "", codigoLeido: null })}
                      className="input"
                    >
                      <option value="">Elegí…</option>
                      {materias.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nombre}
                          {m.tipo === "MASTER" ? " (master)" : ""}
                        </option>
                      ))}
                    </select>
                    {l.codigoLeido && <div className="mt-0.5 font-mono text-[11px] text-foreground-muted">leído: {l.codigoLeido}</div>}
                  </td>
                  <td className="py-1 pr-2">
                    <select aria-label="Lote" value={l.loteMpId} onChange={(e) => upd(l.key, { loteMpId: e.target.value, codigoLeido: null })} className="input">
                      <option value="">Stock sin lote</option>
                      {lotesMp.map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.numeroLote} · {fmtNumero(x.disponible, 3)} kg
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input aria-label="Kg" type="number" step="any" min="0" value={l.cantidadKg} onChange={(e) => upd(l.key, { cantidadKg: e.target.value })} className="input w-28" />
                  </td>
                  <td className="py-1">
                    <button type="button" onClick={() => setLineas((xs) => (xs.length > 1 ? xs.filter((x) => x.key !== l.key) : [nueva()]))} className="text-xs text-foreground-muted hover:text-foreground">
                      Quitar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" onClick={() => setLineas((xs) => [...xs, nueva()])} className="text-sm font-medium text-accent hover:underline">
          + Agregar material
        </button>
        <p className="text-xs text-foreground-muted">
          Material virgen: {fmtNumero(calculo.virgen, 3)} kg · master: {fmtNumero(calculo.master, 3)} kg. Se registra con la fecha y hora actuales.
        </p>
      </section>

      <Campo label="Observaciones">
        <input name="observaciones" className="input" />
      </Campo>
      <button type="submit" disabled={pendiente} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60">
        Registrar retiro a pie de máquina
      </button>
    </form>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-foreground-muted">{label}</span>
      {children}
    </label>
  );
}
