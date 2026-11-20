import type { FilaCompra, Moneda } from "@/lib/data/compras";
import { ESTADO_COMPRA_LABEL, ESTADOS_COMPRA } from "@/lib/data/compras";
import type { Proveedor } from "@/lib/data/proveedores";
import { fmtNumero } from "@/lib/format";

export const BADGE_COMPRA: Record<FilaCompra["estado"], string> = {
  SOLICITADA: "badge-naranja",
  PEDIDO: "badge-info",
  COMPRADO: "badge-info",
  PARCIAL: "badge-bajo",
  DEMORA: "badge-critico",
  FALTANTE: "badge-critico",
  ENTREGADA: "badge-ok",
  CANCELADA: "bg-surface-muted text-foreground-muted",
};

export function fmtMonto(v: number | null, moneda: Moneda): string {
  if (v == null) return "—";
  return `${moneda === "USD" ? "US$" : "$"} ${new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;
}

/** Número para un input editable con la convención argentina (coma decimal). */
export const aInput = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));

export function SelectProveedor({ proveedores, valor, requerido = true }: { proveedores: Proveedor[]; valor?: number | null; requerido?: boolean }) {
  return (
    <select name="proveedorId" required={requerido} defaultValue={valor ?? ""} className="input">
      <option value="" disabled>
        Elegí…
      </option>
      {proveedores.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nombre}
        </option>
      ))}
    </select>
  );
}

export { CamposMonto } from "./campos-monto";

/** Cómo cumplió la fecha de entrega una compra. */
export function Cumplio({ c }: { c: FilaCompra }) {
  if (!c.fechaEntregaEstimada) return <span className="text-foreground-muted">sin fecha estimada</span>;
  if (c.entregadaEl) return (c.diasDemora ?? 0) > 0 ? <span className="badge-estado badge-critico">{c.diasDemora} días tarde</span> : <span className="badge-estado badge-ok">a tiempo</span>;
  if (c.atrasada) return <span className="badge-estado badge-critico">vencida hace {c.diasDemora} días</span>;
  if (c.estado === "CANCELADA") return <span className="text-foreground-muted">—</span>;
  return <span className="text-foreground-muted">en curso</span>;
}

export const OPCIONES_ESTADO = ESTADOS_COMPRA.map((e) => ({ valor: e, label: ESTADO_COMPRA_LABEL[e] }));
export const kgs = (v: number) => `${fmtNumero(v, 3)} kg`;
