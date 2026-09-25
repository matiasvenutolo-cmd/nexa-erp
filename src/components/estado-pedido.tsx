import type { pedido } from "@/lib/db/schema";
import { ESTADO_LABEL } from "@/lib/data/pedidos";

type Estado = (typeof pedido.$inferSelect)["estado"];

const CLASE: Record<Estado, string> = {
  PEDIDO: "badge-estado bg-surface-muted text-foreground-muted",
  EN_ARMADO: "badge-estado badge-bajo",
  LISTO_PARA_DESPACHAR: "badge-estado badge-ok",
  PARCIALMENTE_DESPACHADO: "badge-estado badge-ok",
  ENTREGADO: "badge-estado badge-exceso",
  CANCELADO: "badge-estado badge-critico",
};

export function EstadoPedido({ estado }: { estado: Estado }) {
  return <span className={CLASE[estado]}>{ESTADO_LABEL[estado]}</span>;
}
