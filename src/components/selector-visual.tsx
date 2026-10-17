"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";

export type OpcionVisual = { value: string; label: string; detalle?: string; imagen?: string | null; hex?: string | null; grupo?: string };

function Muestra({ o, grande }: { o: Pick<OpcionVisual, "imagen" | "hex" | "label">; grande?: boolean }) {
  const t = grande ? 36 : 28;
  if (o.imagen) return <Image src={o.imagen} alt="" width={t} height={t} className="shrink-0 rounded-md border border-border bg-white object-contain" />;
  if (o.hex) return <span className="shrink-0 rounded-md border border-[rgba(29,43,58,0.15)]" style={{ width: t, height: t, background: o.hex }} aria-hidden />;
  return <span className="shrink-0 rounded-md border border-dashed border-border" style={{ width: t, height: t }} aria-hidden />;
}

/**
 * Lista desplegable con un dibujito al costado de cada opción (foto del tipo
 * de piso o muestra del color), como en el sistema de presupuestos. Se usa con
 * mouse, teclado (Enter/Espacio para abrir, Escape para cerrar) y en el celular.
 */
export function SelectorVisual({
  opciones,
  value,
  onChange,
  placeholder,
  etiqueta,
  className = "",
}: {
  opciones: OpcionVisual[];
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  etiqueta: string;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const actual = opciones.find((o) => o.value === value);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", fuera);
    return () => document.removeEventListener("mousedown", fuera);
  }, [abierto]);
  const grupos = [...new Set(opciones.map((o) => o.grupo ?? ""))];
  return (
    <div ref={ref} className={`relative ${className}`} onKeyDown={(e) => e.key === "Escape" && setAbierto(false)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-label={etiqueta}
        onClick={() => setAbierto((x) => !x)}
        className="input flex min-h-[46px] items-center gap-2.5 text-left"
      >
        {actual ? <Muestra o={actual} /> : <Muestra o={{ label: "" }} />}
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold ${actual ? "" : "text-foreground-muted"}`}>{actual?.label ?? placeholder}</span>
          {actual?.detalle && <span className="block truncate text-xs text-foreground-muted">{actual.detalle}</span>}
        </span>
        <ChevronDown size={16} className="shrink-0 text-foreground-muted" />
      </button>
      {abierto && (
        <ul role="listbox" aria-label={etiqueta} className="absolute z-40 mt-1 max-h-80 w-full min-w-[240px] overflow-y-auto rounded-lg border border-border bg-white p-1 shadow-xl">
          {grupos.map((g) => (
            <li key={g || "_"}>
              {g && <div className="px-2 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-foreground-muted">{g}</div>}
              <ul>
                {opciones
                  .filter((o) => (o.grupo ?? "") === g)
                  .map((o) => (
                    <li key={o.value}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={o.value === value}
                        onClick={() => {
                          onChange(o.value);
                          setAbierto(false);
                        }}
                        className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-muted ${o.value === value ? "bg-accent-soft" : ""}`}
                      >
                        <Muestra o={o} grande={Boolean(o.imagen)} />
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{o.label}</span>
                          {o.detalle && <span className="block truncate text-xs text-foreground-muted">{o.detalle}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
