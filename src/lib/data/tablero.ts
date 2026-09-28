/**
 * Tablero — pantalla de entrada (docs/07-plan-release-2.md paso 2).
 *
 * Alcance real, no el del mockup viejo completo: éste todavía no tiene datos
 * de producción (no existe `cicloProduccion` hasta R3/paso 4), así que el
 * tablero muestra lo que HOY se puede responder con datos reales — pedidos
 * y stock — y se completa cuando exista producción. "No se pretende
 * resolver toda la parte de indicadores en esta instancia" (minuta
 * 26-28/09) — regla 7, nada de gráficos vacíos.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { producto, cliente } from "@/lib/db/schema";
import { contarPedidosPorEstado, materialComprometido } from "@/lib/data/pedidos";
import { listarProductos } from "@/lib/data/catalogo";

export async function obtenerTablero() {
  const [pedidosPorEstado, productos, comprometido, [{ totalClientes }]] = await Promise.all([
    contarPedidosPorEstado(),
    listarProductos(),
    materialComprometido(),
    db.select({ totalClientes: sql<number>`count(*)`.mapWith(Number) }).from(cliente),
  ]);

  const alertasPorEstado = { critico: 0, bajo: 0, ok: 0, exceso: 0, "sin-datos": 0 } as Record<
    (typeof productos)[number]["estado"],
    number
  >;
  for (const p of productos) alertasPorEstado[p.estado]++;

  const [{ totalProductos }] = await db
    .select({ totalProductos: sql<number>`count(*)`.mapWith(Number) })
    .from(producto);

  return {
    pedidosPorEstado,
    alertasPorEstado,
    productosEnAlerta: productos
      .filter((p) => p.estado === "critico" || p.estado === "bajo")
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 6),
    comprometidoTop: comprometido.filter((c) => c.faltaProducir > 0).slice(0, 6),
    totalProductos,
    totalClientes,
  };
}
