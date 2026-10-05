"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelarPedidoAction } from "@/app/actions/pedidos";

/** Cancelar el pedido (anula el despacho en curso y libera las reservas). */
export function CancelarPedido({ pedidoId }: { pedidoId: number }) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!confirmando) {
    return (
      <button onClick={() => setConfirmando(true)} className="text-sm text-[var(--estado-critico-fg)] hover:underline">
        Cancelar pedido
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-sm">
      <span className="text-foreground-muted">¿Cancelar? Se libera lo reservado; lo ya entregado no cambia.</span>
      <button
        onClick={async () => {
          const r = await cancelarPedidoAction(pedidoId);
          if (r.error) setError(r.error);
          else router.refresh();
        }}
        className="font-medium text-[var(--estado-critico-fg)] hover:underline"
      >
        Sí, cancelar
      </button>
      <button onClick={() => setConfirmando(false)} className="text-foreground-muted hover:text-foreground">
        No
      </button>
      {error && <span className="text-[var(--estado-critico-fg)]">{error}</span>}
    </span>
  );
}
