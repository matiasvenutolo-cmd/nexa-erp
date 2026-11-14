"use client";

import { useState } from "react";
import { FormAccion } from "@/components/form-accion";
import { editarLineasPedidoAction } from "@/app/actions/pedidos";

type Renglon = { lineaId: number; codigo: string; descripcion: string; color: string | null; unidades: number; armadas: number };
type Prod = { id: number; codigo: string; descripcion: string };

/**
 * Productos del pedido (reunión 10/11/2026): cambiar cantidades, quitar un
 * renglón o agregar un color que pidió el cliente. Al guardar le llega el
 * aviso a Administración y al Encargado.
 */
export function EditorLineas({ pedidoId, renglones, productos }: { pedidoId: number; renglones: Renglon[]; productos: Prod[] }) {
  const [cant, setCant] = useState<Record<number, string>>(() => Object.fromEntries(renglones.map((r) => [r.lineaId, String(r.unidades)])));
  const [nuevos, setNuevos] = useState<{ productoId: string; unidades: string }[]>([]);
  const cambios = [
    ...renglones.filter((r) => cant[r.lineaId] !== String(r.unidades)).map((r) => ({ lineaId: r.lineaId, unidades: Number(cant[r.lineaId] || 0) })),
    ...nuevos.filter((n) => n.productoId && Number(n.unidades) > 0).map((n) => ({ productoId: Number(n.productoId), unidades: Number(n.unidades) })),
  ];
  const yaEsta = new Set(renglones.map((r) => r.codigo));
  return (
    <FormAccion accion={editarLineasPedidoAction} ocultos={{ pedidoId, cambios: JSON.stringify(cambios) }} boton="Guardar productos" className="space-y-3">
      <ul className="space-y-2">
        {renglones.map((r) => (
          <li key={r.lineaId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2">
            <span className="min-w-0 text-sm">
              <b>{r.codigo}</b> · {r.descripcion}
              {r.armadas > 0 && <span className="block text-xs text-foreground-muted">{r.armadas} ya armadas: no puede quedar menos.</span>}
            </span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={r.armadas}
                value={cant[r.lineaId]}
                onChange={(e) => setCant((c) => ({ ...c, [r.lineaId]: e.target.value }))}
                className="input w-28 text-right"
                aria-label={`Cantidad de ${r.codigo}`}
              />
              {r.armadas === 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCant((c) => ({ ...c, [r.lineaId]: "0" }))}>
                  Quitar
                </button>
              )}
            </span>
          </li>
        ))}
        {nuevos.map((n, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-accent p-2">
            <select
              value={n.productoId}
              onChange={(e) => setNuevos((xs) => xs.map((x, j) => (j === i ? { ...x, productoId: e.target.value } : x)))}
              className="input min-w-0 flex-1"
              aria-label="Producto a agregar"
            >
              <option value="">Elegí el producto…</option>
              {productos
                .filter((p) => !yaEsta.has(p.codigo))
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.codigo} · {p.descripcion}
                  </option>
                ))}
            </select>
            <input
              type="number"
              min={1}
              value={n.unidades}
              onChange={(e) => setNuevos((xs) => xs.map((x, j) => (j === i ? { ...x, unidades: e.target.value } : x)))}
              placeholder="Cantidad"
              className="input w-28 text-right"
            />
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setNuevos((xs) => [...xs, { productoId: "", unidades: "" }])}>
        + Agregar producto
      </button>
      <input name="motivo" placeholder="Motivo (opcional, ej. el cliente sumó un color)" className="input" />
    </FormAccion>
  );
}
