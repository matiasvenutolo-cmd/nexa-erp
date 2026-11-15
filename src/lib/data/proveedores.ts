import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { compraMp, proveedor, proveedorMaster } from "@/lib/db/schema";
import { puedeGestionarCompras } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import type { FilaCompra, Moneda } from "@/lib/data/compras";

export async function listarProveedoresMaster() {
  return db.select().from(proveedorMaster).orderBy(asc(proveedorMaster.nombre));
}

// ---------------------------------------------------------------------------
// Proveedores de materia prima (ficha, historial y cumplimiento)
// ---------------------------------------------------------------------------

export type Proveedor = typeof proveedor.$inferSelect;
export type ProveedorInput = {
  nombre: string;
  cuit?: string | null;
  contacto?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  condicionPago?: string | null;
  observaciones?: string | null;
  activo?: boolean;
};

export type Cumplimiento = {
  /** Compras ejecutadas (sin contar pedidos sin ejecutar ni canceladas). */
  compras: number;
  enCurso: number;
  entregadas: number;
  /** Entregadas con fecha estimada: sobre ellas se mide el cumplimiento. */
  medidas: number;
  aTiempo: number;
  /** Promedio de días de atraso de las que llegaron tarde. */
  demoraPromedio: number | null;
  /** En curso con la fecha estimada vencida. */
  vencidas: number;
  ultimaCompra: string | null;
  montos: { moneda: Moneda; total: number }[];
};

/** Cumplimiento de fechas de entrega a partir de sus compras. */
export function cumplimientoDe(compras: FilaCompra[]): Cumplimiento {
  const ejecutadas = compras.filter((c) => c.estado !== "SOLICITADA" && c.estado !== "CANCELADA");
  const entregadas = ejecutadas.filter((c) => c.estado === "ENTREGADA");
  const medidas = entregadas.filter((c) => c.fechaEntregaEstimada && c.entregadaEl);
  const tarde = medidas.filter((c) => (c.diasDemora ?? 0) > 0);
  const montos = new Map<Moneda, number>();
  for (const c of ejecutadas) if (c.montoTotal != null) montos.set(c.moneda, (montos.get(c.moneda) ?? 0) + c.montoTotal);
  return {
    compras: ejecutadas.length,
    enCurso: ejecutadas.length - entregadas.length,
    entregadas: entregadas.length,
    medidas: medidas.length,
    aTiempo: medidas.length - tarde.length,
    demoraPromedio: tarde.length ? Math.round((tarde.reduce((t, c) => t + (c.diasDemora ?? 0), 0) / tarde.length) * 10) / 10 : null,
    vencidas: ejecutadas.filter((c) => c.atrasada).length,
    ultimaCompra: ejecutadas.map((c) => c.fechaPedido).sort().at(-1) ?? null,
    montos: [...montos.entries()].map(([moneda, total]) => ({ moneda, total: Math.round(total * 100) / 100 })),
  };
}

export async function listarProveedores(opts: { soloActivos?: boolean } = {}): Promise<(Proveedor & { cumplimiento: Cumplimiento })[]> {
  const { listarCompras } = await import("@/lib/data/compras");
  const [provs, compras] = await Promise.all([
    db.select().from(proveedor).where(opts.soloActivos ? eq(proveedor.activo, true) : undefined).orderBy(asc(proveedor.nombre)),
    listarCompras(),
  ]);
  return provs.map((p) => ({ ...p, cumplimiento: cumplimientoDe(compras.filter((c) => c.proveedorId === p.id)) }));
}

export async function proveedorPorId(id: number): Promise<Proveedor | null> {
  const [p] = await db.select().from(proveedor).where(eq(proveedor.id, id));
  return p ?? null;
}

const CAMPOS = ["nombre", "cuit", "contacto", "telefono", "email", "direccion", "condicionPago", "observaciones"] as const;

/** Alta (sin id) o edición de la ficha. El nombre no se repite (sin distinguir mayúsculas). */
export async function guardarProveedor(actor: Actor, id: number | null, input: ProveedorInput): Promise<Resultado & { id?: number }> {
  if (!puedeGestionarCompras(actor.rol)) return { error: "No tenés permiso para cargar proveedores." };
  const nombre = input.nombre.trim().replace(/\s+/g, " ");
  if (!nombre) return { error: "Falta el nombre del proveedor." };
  if (input.email?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) return { error: "El email no es válido." };
  const [repetido] = await db.select({ id: proveedor.id }).from(proveedor).where(sql`lower(${proveedor.nombre}) = lower(${nombre})`);
  if (repetido && repetido.id !== id) return { error: `Ya hay un proveedor «${nombre}».` };
  const valores = {
    nombre,
    cuit: input.cuit?.trim() || null,
    contacto: input.contacto?.trim() || null,
    telefono: input.telefono?.trim() || null,
    email: input.email?.trim() || null,
    direccion: input.direccion?.trim() || null,
    condicionPago: input.condicionPago?.trim() || null,
    observaciones: input.observaciones?.trim() || null,
    activo: input.activo ?? true,
  };
  return db.transaction(async (tx) => {
    if (id == null) {
      const [p] = await tx.insert(proveedor).values(valores).returning({ id: proveedor.id });
      await registrarCambios(tx, actor.id, [{ entidad: "proveedor", entidadId: p.id, campo: "alta", anterior: null, nuevo: nombre }]);
      return { id: p.id };
    }
    const [antes] = await tx.select().from(proveedor).where(eq(proveedor.id, id)).for("update");
    if (!antes) return { error: "Proveedor no encontrado." };
    await tx.update(proveedor).set(valores).where(eq(proveedor.id, id));
    // Las compras guardan una copia del nombre: se mantiene al día.
    if (antes.nombre !== nombre) await tx.update(compraMp).set({ proveedor: nombre }).where(eq(compraMp.proveedorId, id));
    await registrarCambios(tx, actor.id, [
      ...CAMPOS.map((k) => ({ entidad: "proveedor", entidadId: id, campo: k, anterior: antes[k], nuevo: valores[k] })),
      { entidad: "proveedor", entidadId: id, campo: "activo", anterior: antes.activo ? "sí" : "no", nuevo: valores.activo ? "sí" : "no" },
    ]);
    return { id };
  });
}
