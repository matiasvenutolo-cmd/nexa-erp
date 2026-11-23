"use client";

import { useActionState, useMemo, useState } from "react";
import { identificarCodigoRetiroAction, registrarRetiroAction, type EstadoMaquina } from "@/app/actions/maquina";
import { LectorCodigo, type ResultadoLectura } from "@/components/lector-codigo";
import { INYECTORAS } from "@/lib/inyectoras";
import { fmtNumero } from "@/lib/format";

export type CicloRetiro = {
  /** Una producción en curso, o una tanda en cola a la que se le lleva el
   *  material antes de arrancar (Cambios en Producción, nov. 2026). */
  tipo: "ciclo" | "tanda";
  id: number;
  etiqueta: string;
  productoNumero: string | null;
  kgPorPieza: number | null;
  /** Receta de carga (por carga) del producto, si está definida. */
  receta: { materiaPrimaId: number; kg: number; esMaster: boolean; texto: string }[] | null;
  kgVirgenPorCarga: number | null;
  /** Piezas de la tanda: se precargan (reunión 20/11/2026). */
  piezasObjetivo: number | null;
  /** Lo que falta llevar para toda la tanda, en bolsas enteras (lista «Para llevar»). */
  sugerido: { materiaPrimaId: number; kg: number }[] | null;
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
  inicial,
  usuarioId,
}: {
  ciclos: CicloRetiro[];
  materias: Mp[];
  lotes: Lote[];
  responsables: Persona[];
  entregan: Persona[];
  inicial: string | null;
  usuarioId: number;
}) {
  const [state, action, pendiente] = useActionState<EstadoMaquina, FormData>(registrarRetiroAction, {});
  const [tok] = useState(token);
  const clave = (c: CicloRetiro) => `${c.tipo}-${c.id}`;
  const [destino, setDestino] = useState(inicial && ciclos.some((c) => clave(c) === inicial) ? inicial : "");
  const ciclo = ciclos.find((c) => clave(c) === destino) ?? null;
  // Al elegir la tanda se precargan sus piezas y lo que falta llevar, en bolsas
  // enteras para toda la tanda (reunión 20/11/2026: antes salía una sola carga).
  const precarga = (c: CicloRetiro | null): Linea[] => (c?.sugerido?.length ? c.sugerido.map((x) => nueva({ materiaPrimaId: String(x.materiaPrimaId), cantidadKg: String(x.kg) })) : [nueva()]);
  const [piezas, setPiezas] = useState(ciclo?.piezasObjetivo ? String(ciclo.piezasObjetivo) : "");
  const [lineas, setLineas] = useState<Linea[]>(() => precarga(ciclo));
  const elegir = (valor: string) => {
    setDestino(valor);
    const c = ciclos.find((x) => clave(x) === valor) ?? null;
    setPiezas(c?.piezasObjetivo ? String(c.piezasObjetivo) : "");
    // Sólo se reemplaza lo cargado si todavía no se escribió nada a mano.
    if (lineas.every((l) => !l.materiaPrimaId || !Number(l.cantidadKg))) setLineas(precarga(c));
  };

  const upd = (key: number, patch: Partial<Linea>) => setLineas((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const tipoDe = (id: string) => materias.find((m) => String(m.id) === id)?.tipo;

  // Necesidad y rendimiento estimados con los datos configurados (nada inventado).
  const calculo = useMemo(() => {
    const kg = ciclo?.kgPorPieza ?? null;
    const virgen = lineas.filter((l) => l.materiaPrimaId && tipoDe(l.materiaPrimaId) !== "MASTER").reduce((t, l) => t + (Number(l.cantidadKg) || 0), 0);
    const master = lineas.filter((l) => l.materiaPrimaId && tipoDe(l.materiaPrimaId) === "MASTER").reduce((t, l) => t + (Number(l.cantidadKg) || 0), 0);
    const pzs = Number(piezas) || 0;
    const cargas = kg && pzs && ciclo?.kgVirgenPorCarga ? Math.ceil((pzs * kg) / ciclo.kgVirgenPorCarga - 1e-9) : null;
    return {
      kg,
      virgen,
      master,
      mpNecesaria: kg && pzs ? pzs * kg : null,
      cargas,
      piezasEstimadas: kg && virgen ? Math.floor((virgen + master) / kg) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ciclo, lineas, piezas]);

  /** Cada lectura agrega un renglón con el material (y el lote si es el
   *  código de la bolsa). La vía manual (elegir el material) sigue disponible. */
  async function leer(codigo: string): Promise<ResultadoLectura> {
    const r = await identificarCodigoRetiroAction(codigo, ciclo?.productoNumero ?? null);
    if (r.error || !r.lectura) return { ok: false, mensaje: r.error ?? "No se pudo leer el código." };
    const l = r.lectura;
    if (l.tipo === "material") {
      const ya = lineas.find((x) => x.materiaPrimaId === String(l.materiaPrima.id) && !x.loteMpId);
      if (!ya) setLineas((xs) => [...xs.filter((x) => x.materiaPrimaId), nueva({ materiaPrimaId: String(l.materiaPrima.id) })]);
      return { ok: true, mensaje: `${l.materiaPrima.nombre}${ya ? " (ya estaba en el retiro)" : ""}: completá los kg.` };
    }
    const d = l.dato;
    if (d.lote && lineas.some((x) => x.loteMpId === String(d.lote!.id))) {
      return { ok: false, mensaje: `El lote ${d.lote.numeroLote} ya está en el retiro (doble lectura).` };
    }
    if (!d.lote) return { ok: false, mensaje: d.advertencias.join(" ") || "El código no corresponde a un lote ingresado." };
    setLineas((xs) => [...xs.filter((x) => x.materiaPrimaId), nueva({ materiaPrimaId: String(d.lote!.materiaPrimaId), loteMpId: String(d.lote!.id), codigoLeido: d.codigo })]);
    return {
      ok: true,
      mensaje: [
        `${d.lote.materiaPrimaNombre} · lote ${d.lote.numeroLote} · ${fmtNumero(d.disponibleKg, 3)} kg disponibles`,
        d.certificado ? `certificado N° ${d.certificado.numero} (${d.certificado.proveedor})` : null,
        ...d.advertencias,
      ]
        .filter(Boolean)
        .join(" · "),
    };
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
        <Campo label="Producción">
          <select value={destino} onChange={(e) => elegir(e.target.value)} className="input">
            <option value="">Sin producción (otro uso)</option>
            {(["ciclo", "tanda"] as const).map((tipo) =>
              ciclos.some((c) => c.tipo === tipo) ? (
                <optgroup key={tipo} label={tipo === "ciclo" ? "Producciones en curso" : "Tandas en cola (todavía sin arrancar)"}>
                  {ciclos
                    .filter((c) => c.tipo === tipo)
                    .map((c) => (
                      <option key={clave(c)} value={clave(c)}>
                        {c.etiqueta}
                      </option>
                    ))}
                </optgroup>
              ) : null,
            )}
          </select>
          <input type="hidden" name="cicloId" value={ciclo?.tipo === "ciclo" ? ciclo.id : ""} />
          <input type="hidden" name="tandaId" value={ciclo?.tipo === "tanda" ? ciclo.id : ""} />
        </Campo>
        {ciclo ? (
          <Campo label="Inyectora">
            <input className="input bg-surface-muted" readOnly value={ciclo.tipo === "tanda" ? "La de la tanda" : "La de la producción"} />
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
        <Campo label="Quién lo lleva a la máquina">
          <select name="operarioId" defaultValue="" className="input">
            <option value="">—</option>
            {responsables.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Lo registra (Materia prima)">
          <select name="entregaId" defaultValue={entregan.some((u) => u.id === usuarioId) ? usuarioId : ""} className="input">
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
        <p className="text-xs text-foreground-muted">No hay producciones en curso ni tandas en cola con máquina asignada. Se puede llevar el material antes de que el operario arranque: elegí la tanda en cola.</p>
      )}

      {/* Cambios del 23/11/2026: a Materia prima no le interesan las piezas: lleva lo que pide
          la receta para la tanda, ya precargado. Las piezas quedan registradas igual. */}
      <input type="hidden" name="piezasPrevistas" value={piezas} />
      <section className="space-y-2">
        <LectorCodigo onLeer={leer} etiqueta="Lector de código de barras" placeholder="Código de la bolsa (27 dígitos) o del material (ej. 031, B24)" />
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
