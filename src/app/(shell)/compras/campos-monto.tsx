"use client";

import { useEffect, useRef, useState } from "react";
import type { Moneda } from "@/lib/data/compras";
import { parseCantidadAR } from "@/lib/presentaciones";

const aInput = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
const fmt = (v: number, moneda: string) => `${moneda === "USD" ? "US$" : "$"} ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;

/**
 * Precio por kg, total y moneda: se carga uno de los dos y el otro se calcula
 * a la vista mientras se escribe (reunión 20/11/2026: «se debería
 * autocalcular el precio total»). Toma la cantidad del campo `cantidadKg` del
 * mismo formulario. Al guardar, el servidor hace la misma cuenta.
 */
export function CamposMonto({ precioKg, montoTotal, moneda }: { precioKg?: number | null; montoTotal?: number | null; moneda?: Moneda }) {
  const ref = useRef<HTMLDivElement>(null);
  const [precio, setPrecio] = useState(aInput(precioKg ?? null));
  const [total, setTotal] = useState(aInput(montoTotal ?? null));
  const [mon, setMon] = useState<string>(moneda ?? "ARS");
  const [cantidad, setCantidad] = useState<number | null>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    const campo = form?.elements.namedItem("cantidadKg");
    if (!(campo instanceof HTMLInputElement)) return;
    const leer = () => setCantidad(parseCantidadAR(campo.value));
    leer();
    campo.addEventListener("input", leer);
    return () => campo.removeEventListener("input", leer);
  }, []);
  const p = precio.trim() ? parseCantidadAR(precio) : null;
  const t = total.trim() ? parseCantidadAR(total) : null;
  const calculado = cantidad && cantidad > 0 ? (t != null ? { texto: `Precio por kg: ${fmt(t / cantidad, mon)}` } : p != null ? { texto: `Total: ${fmt(p * cantidad, mon)}` } : null) : null;
  return (
    <div ref={ref} className="contents">
      <label className="campo">
        <span>Precio por kg</span>
        <input name="precioKg" inputMode="decimal" value={precio} onChange={(e) => {
            setPrecio(e.target.value);
            // Se carga uno de los dos: el otro se recalcula.
            setTotal("");
          }} placeholder="Ej.: 1.850,50" className="input" />
      </label>
      <label className="campo">
        <span>Monto total</span>
        <input name="montoTotal" inputMode="decimal" value={total} onChange={(e) => {
            setTotal(e.target.value);
            setPrecio("");
          }} placeholder="o el total" className="input" />
        {calculado && <span className="campo-ayuda font-semibold text-brand-azul">{calculado.texto}</span>}
      </label>
      <label className="campo">
        <span>Moneda</span>
        <select name="moneda" value={mon} onChange={(e) => setMon(e.target.value)} className="input">
          <option value="ARS">Pesos</option>
          <option value="USD">Dólares</option>
        </select>
      </label>
    </div>
  );
}
