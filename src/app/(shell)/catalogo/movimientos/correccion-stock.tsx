"use client";

import { useActionState, useState } from "react";
import { corregirStockAction, type FormState } from "@/app/actions/stock";
import type { FilaProducto } from "@/lib/data/catalogo";

export function CorreccionStock({ productos }: { productos: FilaProducto[] }) {
  const [abierto, setAbierto] = useState(false);
  const [state, formAction] = useActionState<FormState, FormData>(corregirStockAction, {});

  if (!abierto) {
    return (
      <button onClick={() => setAbierto(true)} className="text-sm font-medium text-accent hover:underline">
        Corrección manual de stock
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      {state.error && (
        <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">
          {state.error}
        </div>
      )}
      {state.ok && (
        <div className="rounded-md bg-[var(--estado-ok-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-ok-fg)]">
          Ajuste guardado. Se refleja en el stock y en el historial de abajo.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block text-foreground-muted">Producto</span>
          <select name="productoId" required className="input" defaultValue="">
            <option value="" disabled>
              Elegí un producto…
            </option>
            {productos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} · {p.descripcion} (stock {p.stock})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Ajuste (+/−)</span>
          <input name="delta" type="number" step="1" required className="input" placeholder="ej. -3" />
        </label>
      </div>
      <label className="block text-sm">
        <span className="mb-1 block text-foreground-muted">Motivo</span>
        <input name="motivo" required className="input" placeholder="ej. recuento físico del viernes" />
      </label>
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Guardar ajuste
        </button>
        <button type="button" onClick={() => setAbierto(false)} className="text-sm text-foreground-muted hover:text-foreground">
          Cancelar
        </button>
      </div>
    </form>
  );
}
