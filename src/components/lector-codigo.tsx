"use client";

import { useEffect, useRef, useState } from "react";
import { ScanLine } from "lucide-react";

export type ResultadoLectura = { ok: boolean; mensaje: string };

/** Letras, números y guiones (lo que tipea un lector en modo teclado). */
export function limpiarCodigo(texto: string): { codigo: string } | { error: string } {
  const c = texto.trim().replace(/\s+/g, "");
  if (!c) return { error: "Código vacío." };
  if (!/^[A-Za-z0-9-]+$/.test(c)) return { error: `«${c}» tiene caracteres que no son letras, números ni guiones: revisá la distribución de teclado del lector.` };
  return { codigo: c.toUpperCase() };
}

/** ¿La misma lectura llegó dos veces en menos de `ms`? (el lector a veces repite). */
export function esLecturaRepetida(anterior: { codigo: string; en: number } | null, codigo: string, ahora: number, ms = 1000): boolean {
  return Boolean(anterior && anterior.codigo === codigo && ahora - anterior.en < ms);
}

function pitido(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.05;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.08 : 0.25));
    o.onended = () => void ctx.close();
  } catch {
    // Sin audio no pasa nada: queda el aviso visual.
  }
}

/**
 * Campo dedicado para lectores de código de barras USB o inalámbricos en modo
 * teclado (el lector «tipea» el código y un Enter). También sirve a mano:
 * escribir el código y apretar Enter hace exactamente lo mismo, así que el
 * módulo funciona sin lector.
 *
 *  - foco fijo: si el foco queda en la nada vuelve al lector (no le roba el
 *    foco a otro campo que se esté completando);
 *  - ignora la misma lectura repetida en menos de 1 segundo;
 *  - verde/rojo + sonido según si el sistema reconoció el código (el pitido
 *    del lector sólo indica que leyó, no que el código sea válido).
 */
export function LectorCodigo({
  onLeer,
  etiqueta = "Leer código",
  placeholder = "Escaneá o escribí el código y Enter",
  focoFijo = true,
}: {
  onLeer: (codigo: string) => Promise<ResultadoLectura>;
  etiqueta?: string;
  placeholder?: string;
  focoFijo?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const ultima = useRef<{ codigo: string; en: number } | null>(null);
  const [valor, setValor] = useState("");
  const [fijo, setFijo] = useState(focoFijo);
  const [estado, setEstado] = useState<(ResultadoLectura & { codigo?: string }) | null>(null);
  const [leyendo, setLeyendo] = useState(false);

  useEffect(() => {
    if (!fijo) return;
    ref.current?.focus();
    const volver = () => {
      // Sólo si el foco quedó en el cuerpo de la página (no en otro campo).
      setTimeout(() => {
        const a = document.activeElement;
        if (!a || a === document.body) ref.current?.focus();
      }, 50);
    };
    const input = ref.current;
    input?.addEventListener("blur", volver);
    document.addEventListener("click", volver);
    return () => {
      input?.removeEventListener("blur", volver);
      document.removeEventListener("click", volver);
    };
  }, [fijo]);

  async function leer() {
    const l = limpiarCodigo(valor);
    setValor("");
    if ("error" in l) {
      setEstado({ ok: false, mensaje: l.error });
      pitido(false);
      return;
    }
    const ahora = Date.now();
    if (esLecturaRepetida(ultima.current, l.codigo, ahora)) {
      setEstado({ ok: true, mensaje: "Lectura repetida ignorada (mismo código en menos de 1 segundo).", codigo: l.codigo });
      return;
    }
    ultima.current = { codigo: l.codigo, en: ahora };
    setLeyendo(true);
    try {
      const r = await onLeer(l.codigo);
      setEstado({ ...r, codigo: l.codigo });
      pitido(r.ok);
    } finally {
      setLeyendo(false);
      ref.current?.focus();
    }
  }

  const color = estado == null ? "border-border" : estado.ok ? "border-[var(--estado-ok-fg)] bg-[var(--estado-ok-bg)]" : "border-[var(--estado-critico-fg)] bg-[var(--estado-critico-bg)]";
  return (
    <div className={`rounded-lg border-2 p-3 transition-colors ${color}`} data-lector>
      <label className="block text-sm">
        <span className="mb-1 flex items-center gap-1.5 font-semibold text-foreground">
          <ScanLine size={16} aria-hidden /> {etiqueta}
        </span>
        <div className="flex gap-2">
          <input
            ref={ref}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void leer();
              }
            }}
            className="input flex-1 font-mono"
            placeholder={placeholder}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label={etiqueta}
          />
          <button type="button" onClick={() => void leer()} disabled={leyendo || !valor.trim()} className="btn btn-azul btn-sm">
            {leyendo ? "Leyendo…" : "Leer"}
          </button>
        </div>
      </label>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className={`text-xs font-semibold ${estado == null ? "text-foreground-muted" : estado.ok ? "text-[var(--estado-ok-fg)]" : "text-[var(--estado-critico-fg)]"}`}>
          {estado ? `${estado.ok ? "✓" : "✗"} ${estado.codigo ? `${estado.codigo}: ` : ""}${estado.mensaje}` : "Listo para leer. Sin lector: escribí el código y apretá Enter."}
        </p>
        <label className="flex items-center gap-1 text-xs text-foreground-muted">
          <input type="checkbox" checked={fijo} onChange={(e) => setFijo(e.target.checked)} /> foco fijo en el lector
        </label>
      </div>
    </div>
  );
}
