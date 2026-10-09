import type { resumirPedido } from "@/lib/resumen-pedido";
import { fmtNumero } from "@/lib/format";

/** Bloque de resumen: baldosas por producto y color, accesorios por tipo y color, total y m². */
export function ResumenPedido({ r }: { r: ReturnType<typeof resumirPedido> }) {
  return (
    <div className="space-y-2 text-sm">
      {r.baldosas.length > 0 && (
        <ul className="space-y-0.5">
          {r.baldosas.map((g) => (
            <li key={g.etiqueta} className="flex justify-between gap-3">
              <span className="text-foreground-muted">{g.etiqueta}</span>
              <span className="font-medium tabular-nums">{fmtNumero(g.unidades, 0)} u.</span>
            </li>
          ))}
        </ul>
      )}
      {r.accesorios.length > 0 && (
        <ul className="space-y-0.5 border-t border-border pt-2">
          {r.accesorios.map((g) => (
            <li key={g.etiqueta} className="flex justify-between gap-3">
              <span className="text-foreground-muted">{g.etiqueta}</span>
              <span className="font-medium tabular-nums">{fmtNumero(g.unidades, 0)} u.</span>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-0.5 border-t border-border pt-2">
        <div className="flex justify-between">
          <span className="text-foreground-muted">Total de baldosas</span>
          <span className="font-semibold tabular-nums">{fmtNumero(r.totalBaldosas, 0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-foreground-muted">Superficie de baldosas</span>
          <span className="font-semibold tabular-nums">
            {r.totalBaldosas === 0 ? "—" : `${fmtNumero(r.m2Total, 2)} m²${r.sinSuperficie.length ? " (incompleta)" : ""}`}
          </span>
        </div>
        {r.totalAccesorios > 0 && <p className="text-xs text-foreground-muted">Los accesorios no suman superficie.</p>}
        {r.sinSuperficie.length > 0 && (
          <p className="text-xs text-[var(--estado-bajo-fg)]">
            Sin m² por pieza configurado: {r.sinSuperficie.join(", ")}. Se configura en Panel Admin → Productos.
          </p>
        )}
        {r.sinProducto > 0 && (
          <p className="text-xs text-foreground-muted">{r.sinProducto} renglón(es) sin producto: no entran en el resumen.</p>
        )}
      </div>
    </div>
  );
}
