/**
 * Situación de compra de cada material (pedido de NEXA, nov. 2026): Materia
 * prima ve en su tabla de stock qué hay que pedir a Compras, en vez de que
 * Compras calcule la necesidad.
 *
 * - Comprometido a producción: el material que todavía necesitan las tandas
 *   planificadas y en curso (lo que falta producir). Se cubre primero con lo
 *   que ya está a pie de máquina; lo demás sale del stock general.
 * - Compra urgente: el stock general no alcanza para lo que falta llevar a
 *   esas tandas.
 * - Compra próximamente: lo que queda libre no cubre los pedidos todavía sin
 *   planificar más el margen del material (Panel admin; vacío = su mínimo).
 * - OK: el resto.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { materiaPrima, producto } from "@/lib/db/schema";
import { aGramos } from "@/lib/presentaciones";

export type EstadoCompraMp = "URGENTE" | "PROXIMAMENTE" | "OK";
export const ESTADO_COMPRA_MP_LABEL: Record<EstadoCompraMp, string> = { URGENTE: "Compra urgente", PROXIMAMENTE: "Compra próximamente", OK: "OK" };
export const ORDEN_ESTADO_COMPRA_MP: Record<EstadoCompraMp, number> = { URGENTE: 0, PROXIMAMENTE: 1, OK: 2 };

export type SituacionMp = {
  depositoKg: number;
  pieKg: number;
  /** Lo que piden las tandas planificadas y en curso. */
  comprometidoKg: number;
  /** Comprometido que todavía hay que llevar desde el stock general. */
  faltaLlevarKg: number;
  /** Stock general menos lo que falta llevar (negativo: no alcanza). */
  libreKg: number;
  pedidosSinPlanificarKg: number;
  /** Margen del material (Panel admin) o, si no tiene, su mínimo. */
  margenKg: number;
  estado: EstadoCompraMp;
  /** Kg que conviene pedir para volver a OK, descontando lo ya pedido o comprado. */
  sugeridoKg: number;
  /** Pedido a Compras o comprado y todavía no entregado. */
  enCompraKg: number;
  proximaEntrega: string | null;
  /** Compra con demora o faltante en proveedor. */
  riesgo: string | null;
  /** El cálculo usa pesos por pieza sin confirmar. */
  estimado: boolean;
};

const kg = (g: number) => g / 1000;

export async function situacionCompraMp(): Promise<Map<number, SituacionMp>> {
  const { listarTandas, gruposParaPlanificar, materialParaPiezas, disponibleMp } = await import("@/lib/data/planificacion");
  const { recetasDe } = await import("@/lib/data/recetas");
  const { listarCompras } = await import("@/lib/data/compras");

  const [tandas, grupos, mps, prods] = await Promise.all([
    listarTandas(),
    gruposParaPlanificar(),
    db
      .select({ id: materiaPrima.id, tipo: materiaPrima.tipo, minimo: materiaPrima.minimo, aviso: materiaPrima.avisoCompraKg })
      .from(materiaPrima)
      .where(and(eq(materiaPrima.activo, true), inArray(materiaPrima.tipo, ["VIRGEN", "MASTER"]))),
    db.select({ id: producto.id, kg: producto.kgPorUnidad, pesoOk: producto.pesoConfirmado }).from(producto).where(eq(producto.activo, true)),
  ]);
  const porProd = new Map(prods.map((p) => [p.id, p]));
  const comprometido = new Map<number, number>(); // gramos
  const sinPlanificar = new Map<number, number>(); // gramos
  const estimado = new Set<number>();
  const sumar = (m: Map<number, number>, id: number, kgs: number) => m.set(id, (m.get(id) ?? 0) + aGramos(kgs));

  for (const t of tandas) {
    if (t.estado !== "PLANIFICADA" && t.estado !== "EN_CURSO") continue;
    for (const m of t.material) {
      sumar(comprometido, m.materiaPrimaId, m.requeridoKg);
      if (!porProd.get(t.productoId)?.pesoOk) estimado.add(m.materiaPrimaId);
    }
  }
  const recetas = await recetasDe(grupos.map((g) => g.productoId));
  for (const g of grupos) {
    if (g.aPlanificar <= 0) continue;
    const p = porProd.get(g.productoId);
    const pieza = p?.kg != null && Number(p.kg) > 0 ? Number(p.kg) : null;
    const mat = materialParaPiezas(g.aPlanificar, pieza, recetas.get(g.productoId)?.REGIMEN ?? null, null);
    if (!mat) continue; // sin receta o sin peso: no se inventa un valor
    for (const [id, m] of mat.porMp) {
      sumar(sinPlanificar, id, m.kg);
      if (!p?.pesoOk) estimado.add(id);
    }
  }

  const ids = mps.map((m) => m.id);
  const [disp, compras] = await Promise.all([disponibleMp(ids), listarCompras()]);
  const res = new Map<number, SituacionMp>();
  for (const m of mps) {
    const d = disp.get(m.id) ?? { deposito: 0, pie: 0 };
    const dep = aGramos(d.deposito);
    const pie = aGramos(d.pie);
    const comp = comprometido.get(m.id) ?? 0;
    const faltaLlevar = Math.max(0, comp - pie);
    const libre = dep - faltaLlevar;
    const sp = sinPlanificar.get(m.id) ?? 0;
    const margen = aGramos(m.aviso != null ? Number(m.aviso) : m.minimo != null ? Number(m.minimo) : 0);
    const estado: EstadoCompraMp = libre < 0 ? "URGENTE" : libre < sp + margen ? "PROXIMAMENTE" : "OK";
    const mias = compras.filter((c) => c.materiaPrimaId === m.id);
    const abiertas = mias.filter((c) => c.estado === "SOLICITADA" || c.pendienteKg > 0);
    const enCompra = abiertas.reduce((t, c) => t + aGramos(c.estado === "SOLICITADA" ? c.cantidadKg : c.pendienteKg), 0);
    const fechas = abiertas.map((c) => c.fechaEntregaEstimada).filter((f): f is string => !!f).sort();
    const problema = abiertas.find((c) => c.estado === "DEMORA" || c.estado === "FALTANTE" || c.atrasada);
    const falta = estado === "OK" ? 0 : Math.max(0, sp + margen - libre - enCompra);
    res.set(m.id, {
      depositoKg: kg(dep),
      pieKg: kg(pie),
      comprometidoKg: kg(comp),
      faltaLlevarKg: kg(faltaLlevar),
      libreKg: kg(libre),
      pedidosSinPlanificarKg: kg(sp),
      margenKg: kg(margen),
      estado,
      sugeridoKg: falta > 0 ? Math.ceil(kg(falta)) : 0,
      enCompraKg: kg(enCompra),
      proximaEntrega: fechas[0] ?? null,
      riesgo: problema
        ? problema.estado === "FALTANTE"
          ? `Compra #${problema.id}: faltante en proveedor`
          : `Compra #${problema.id} con demora${problema.fechaEntregaEstimada ? ` (entrega estimada ${problema.fechaEntregaEstimada.split("-").reverse().join("/")})` : ""}`
        : null,
      estimado: estimado.has(m.id),
    });
  }
  return res;
}
