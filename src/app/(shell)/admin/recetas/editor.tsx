"use client";

import { useMemo, useState } from "react";
import { Minus, Plus, Trash2 } from "lucide-react";
import { FormAccion } from "@/components/form-accion";
import { guardarRecetaAction } from "@/app/actions/planificacion";
import { aGramos, fmtCantidadBolsas, fmtPeso, kgDe } from "@/lib/presentaciones";

type Material = { id: number; codigo: string; nombre: string; tipo: string };
type Pres = { id: number; nombre: string; kg: number; materiaPrimaId: number | null; tipoMp: string | null };
type Fila = { materiaPrimaId: number | ""; presentacionId: number | ""; cantidad: number };

/** Editor de una receta: material, presentación y cantidad de bolsas (medias incluidas). */
export function EditorReceta({
  productoId,
  tipo,
  inicial,
  materiales,
  presentaciones,
}: {
  productoId: number;
  tipo: "REGIMEN" | "ARRANQUE";
  inicial: { materiaPrimaId: number; presentacionId: number; cantidad: number }[];
  materiales: Material[];
  presentaciones: Pres[];
}) {
  const [filas, setFilas] = useState<Fila[]>(inicial.length ? inicial : [{ materiaPrimaId: "", presentacionId: "", cantidad: 1 }]);
  const presDe = (mpId: number | "") => {
    const mp = materiales.find((m) => m.id === mpId);
    return mp ? presentaciones.filter((p) => p.materiaPrimaId === mp.id || (p.materiaPrimaId == null && p.tipoMp === mp.tipo)) : [];
  };
  const set = (k: number, cambio: Partial<Fila>) => setFilas((f) => f.map((x, j) => (j === k ? { ...x, ...cambio } : x)));
  const totales = useMemo(() => {
    let v = 0;
    let m = 0;
    for (const f of filas) {
      const p = presentaciones.find((x) => x.id === f.presentacionId);
      const mp = materiales.find((x) => x.id === f.materiaPrimaId);
      if (!p || !mp) continue;
      const g = aGramos(kgDe(f.cantidad, p.kg));
      if (mp.tipo === "MASTER") m += g;
      else v += g;
    }
    return { v: v / 1000, m: m / 1000 };
  }, [filas, presentaciones, materiales]);

  return (
    <FormAccion accion={guardarRecetaAction} ocultos={{ productoId, tipo }} boton={tipo === "ARRANQUE" ? "Guardar receta de arranque" : "Guardar receta"} className="space-y-3">
      <input type="hidden" name="items" value={JSON.stringify(filas.filter((f) => f.materiaPrimaId && f.presentacionId))} />
      {filas.map((f, k) => {
        const pres = presDe(f.materiaPrimaId);
        return (
          <div key={k} className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-white p-2">
            <label className="campo min-w-56 flex-1">
              <span>Material</span>
              <select
                className="input"
                value={f.materiaPrimaId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  set(k, { materiaPrimaId: id, presentacionId: presDe(id)[0]?.id ?? "" });
                }}
              >
                <option value="">Elegí…</option>
                {["VIRGEN", "MASTER", "MOLIENDA", "SOBRANTE"].map((t) => (
                  <optgroup key={t} label={t === "VIRGEN" ? "Materia prima" : t === "MASTER" ? "Master" : t === "MOLIENDA" ? "Molienda" : "Sobrante"}>
                    {materiales
                      .filter((m) => m.tipo === t)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nombre}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="campo w-44">
              <span>Presentación</span>
              <select className="input" value={f.presentacionId} onChange={(e) => set(k, { presentacionId: Number(e.target.value) })}>
                {pres.length === 0 && <option value="">Sin presentaciones</option>}
                {pres.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <div className="campo">
              <span>Cantidad</span>
              <div className="flex items-center gap-1">
                <button type="button" className="btn btn-outline btn-sm" onClick={() => set(k, { cantidad: Math.max(0.5, f.cantidad - 0.5) })} aria-label="Media bolsa menos">
                  <Minus size={14} />
                </button>
                <span className="w-12 text-center font-[family-name:var(--font-display)] text-lg font-bold">{fmtCantidadBolsas(f.cantidad)}</span>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => set(k, { cantidad: f.cantidad + 0.5 })} aria-label="Media bolsa más">
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilas((x) => x.filter((_, j) => j !== k))} aria-label="Quitar material">
              <Trash2 size={15} />
            </button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn btn-outline btn-sm" onClick={() => setFilas((x) => [...x, { materiaPrimaId: "", presentacionId: "", cantidad: 1 }])}>
          <Plus size={14} /> Agregar material
        </button>
        <span className="text-sm text-foreground-muted">
          Por carga: <b>{fmtPeso(totales.v)}</b> de material + <b>{fmtPeso(totales.m, { gramos: true })}</b> de master
        </span>
      </div>
      <input name="motivo" placeholder="Motivo del cambio (queda en el historial)" className="input" />
    </FormAccion>
  );
}
