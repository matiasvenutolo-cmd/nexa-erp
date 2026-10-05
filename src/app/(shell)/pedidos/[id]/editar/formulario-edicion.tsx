"use client";

import { useActionState, useState } from "react";
import { editarPedidoAction, type FormState } from "@/app/actions/pedidos";
import type { PedidoConDetalle } from "@/lib/data/pedidos";

const METODOS_PAGO = [
  "Efectivo",
  "Transferencia",
  "Contado / transferencia",
  "Tarjeta de crédito",
  "Cheque",
  "Mercado Pago",
];

export function FormularioEdicion({
  pedido,
  puedeVerPrecios,
}: {
  pedido: PedidoConDetalle;
  puedeVerPrecios: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(editarPedidoAction, {});
  const [requiereColocacion, setRequiereColocacion] = useState(pedido.requiereColocacion);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <input type="hidden" name="pedidoId" value={pedido.id} />

      {state.error && (
        <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">
          {state.error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Contacto (teléfono)">
          <input name="contacto" defaultValue={pedido.contacto ?? ""} className="input" />
        </Campo>
        <Campo label="Domicilio de entrega">
          <input name="domicilio" defaultValue={pedido.domicilioEntrega ?? ""} className="input" />
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Fecha de entrega comprometida">
          <input
            type="date"
            name="fechaEntregaPactada"
            defaultValue={pedido.fechaEntregaPactada ?? ""}
            className="input"
          />
        </Campo>
        <Campo label="Modo de entrega">
          <select name="modoEntrega" defaultValue={pedido.modoEntrega ?? ""} className="input">
            <option value="">—</option>
            <option value="Retiro en fábrica">Retiro en fábrica</option>
            <option value="Flete">Flete</option>
          </select>
        </Campo>
        <label className="mt-6 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={requiereColocacion}
            onChange={(e) => setRequiereColocacion(e.target.checked)}
          />
          Requiere servicio de colocación
          <input type="hidden" name="requiereColocacion" value={requiereColocacion ? "1" : "0"} />
        </label>
      </div>

      {puedeVerPrecios && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo label="Método de pago">
            <select name="metodoPago" defaultValue={pedido.metodoPago ?? ""} className="input">
              <option value="">—</option>
              {METODOS_PAGO.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="N° de comprobante de pago">
            <input name="numeroComprobante" defaultValue={pedido.numeroComprobante ?? ""} className="input" />
          </Campo>
          <Campo label="Total">
            <input name="total" type="number" min={0} step="0.01" defaultValue={pedido.total ?? ""} className="input" />
          </Campo>
          <Campo label="Seña">
            <input name="senia" type="number" min={0} step="0.01" defaultValue={pedido.senia ?? ""} className="input" />
          </Campo>
        </div>
      )}

      <Campo label="Observaciones">
        <textarea name="observaciones" rows={3} defaultValue={pedido.observaciones ?? ""} className="input" />
      </Campo>

      <button
        type="submit"
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90"
      >
        Guardar cambios
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
