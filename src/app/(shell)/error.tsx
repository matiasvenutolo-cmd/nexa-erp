"use client";

import Link from "next/link";

/**
 * Pantalla de error amable (en vez de la pantalla genérica): explica qué pasó
 * y qué hacer. Lo que ya se guardó, quedó guardado; nada se registra dos veces
 * porque las operaciones de stock tienen clave anti-repetición.
 */
export default function ErrorShell({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg">
      <div className="panel space-y-3 text-center">
        <h1 className="text-2xl">No se pudo completar la operación</h1>
        <p className="text-sm text-foreground-muted">
          Algo falló al mostrar o guardar esta pantalla. Antes de repetir, revisá si el registro ya figura (por ejemplo en la lista de pedidos o en
          los movimientos): lo que se guardó, quedó guardado.
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button type="button" onClick={reset} className="btn btn-primary">
            Volver a intentar
          </button>
          <Link href="/" className="btn btn-outline">
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  );
}
