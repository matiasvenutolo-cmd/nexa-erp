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

/**
 * Listo para despachar con sólo una parte armada (listado del 7/11: «le faltan
 * productos»): se aclara «(parcial)»; el despacho de lo armado sí está listo.
 */
export function EstadoPedido({ estado, parcial = false }: { estado: Estado; parcial?: boolean }) {
  const texto = estado === "LISTO_PARA_DESPACHAR" && parcial ? "Listo para despachar (parcial)" : ESTADO_LABEL[estado];
  return <span className={estado === "LISTO_PARA_DESPACHAR" && parcial ? "badge-estado badge-bajo" : CLASE[estado]}>{texto}</span>;
}
