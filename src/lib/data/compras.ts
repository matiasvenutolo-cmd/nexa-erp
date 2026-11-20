/**
 * Compras de materia prima y master (mejoras 22/10, perfil Compras).
 *
 * Una compra se registra al pedirla y se sigue por estado. El material
 * ENTRA AL STOCK sólo por el ingreso de proveedor (Materia prima → Ingreso),
 * que se imputa a la compra: así cada kilo se cuenta una vez y la compra pasa
 * sola a «parcialmente entregada» o «entregada».
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { compraEntrega, compraMp, materiaPrima, proveedor as proveedorT, usuario } from "@/lib/db/schema";
import { puedeGestionarCompras, puedeIngresarMateriaPrima } from "@/lib/auth/permisos";
import { crearAviso } from "@/lib/data/avisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { hoyISO } from "@/lib/format";
import { aGramos } from "@/lib/presentaciones";

export type EstadoCompra = (typeof compraMp.$inferSelect)["estado"];
export const ESTADOS_COMPRA: EstadoCompra[] = ["PEDIDO", "COMPRADO", "PARCIAL", "DEMORA", "FALTANTE", "ENTREGADA", "CANCELADA"];
export const ESTADO_COMPRA_LABEL: Record<EstadoCompra, string> = {
  SOLICITADA: "Pedida por Materia prima",
  PEDIDO: "Pedido / en proceso",
  COMPRADO: "Comprado",
  PARCIAL: "Parcialmente entregado",
  DEMORA: "Con demora",
  FALTANTE: "Faltante en proveedor",
  ENTREGADA: "Entregada",
  CANCELADA: "Cancelada",
};
/** Nombres que usa el cliente en el mail y en el Excel → estado único. */
export const EQUIVALENCIAS_ESTADO: Record<string, EstadoCompra> = {
  pedido: "PEDIDO",
  "en proceso": "PEDIDO",
  comprado: "COMPRADO",
  "parcialmente entregado": "PARCIAL",
  "con demora": "DEMORA",
  "con demoras de entrega": "DEMORA",
  "faltante en proveedor": "FALTANTE",
  "material faltante": "FALTANTE",
};
export const ABIERTAS: EstadoCompra[] = ["PEDIDO", "COMPRADO", "PARCIAL", "DEMORA", "FALTANTE"];

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export const MONEDAS = ["ARS", "USD"] as const;
export type Moneda = (typeof MONEDAS)[number];

/** Día (AAAA-MM-DD) de un momento, en hora argentina. */
const diaAR = (d: Date) => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(d);
/** Días de b a a (a − b). */
const dias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

/**
 * Precio por kg y total: se carga uno y el otro sale de la cantidad. Si se
 * cargan los dos, se guardan como vienen (puede haber fletes o impuestos).
 */
export function montosDe(cantidadKg: number, precioKg: number | null | undefined, montoTotal: number | null | undefined): { error?: string; precioKg: number | null; montoTotal: number | null } {
  for (const [n, v] of [["precio por kg", precioKg], ["monto total", montoTotal]] as const) {
    if (v != null && (!Number.isFinite(v) || v < 0)) return { error: `El ${n} tiene que ser un número mayor o igual a cero.`, precioKg: null, montoTotal: null };
  }
  const p = precioKg ?? null;
  const t = montoTotal ?? null;
  if (p != null && t == null) return { precioKg: p, montoTotal: Math.round(p * cantidadKg * 100) / 100 };
  if (t != null && p == null) return { precioKg: cantidadKg > 0 ? Math.round((t / cantidadKg) * 10000) / 10000 : null, montoTotal: t };
  return { precioKg: p, montoTotal: t };
}

export type FilaCompra = {
  id: number;
  materiaPrimaId: number;
  materiaPrimaNombre: string;
  esMaster: boolean;
  proveedor: string | null;
  proveedorId: number | null;
  precioKg: number | null;
  montoTotal: number | null;
  moneda: Moneda;
  cantidadKg: number;
  recibidoKg: number;
  pendienteKg: number;
  fechaPedido: string;
  fechaEntregaEstimada: string | null;
  numeroOc: string | null;
  estado: EstadoCompra;
  observaciones: string | null;
  creadoPorNombre: string;
  /** Pasó la fecha estimada y sigue abierta. */
  atrasada: boolean;
  /** Día de la última entrega, si la compra se completó. */
  entregadaEl: string | null;
  /** Días de atraso contra la entrega estimada (entregada tarde, o abierta y vencida); 0 si cumplió. */
  diasDemora: number | null;
  entregas: { id: number; fecha: Date; kg: number; loteMpId: number | null; usuarioNombre: string; observaciones: string | null }[];
};

export async function listarCompras(filtro: { abiertas?: boolean; materiaPrimaId?: number; proveedorId?: number; estados?: EstadoCompra[] } = {}): Promise<FilaCompra[]> {
  const cond = [];
  if (filtro.abiertas) cond.push(inArray(compraMp.estado, ABIERTAS));
  if (filtro.estados?.length) cond.push(inArray(compraMp.estado, filtro.estados));
  if (filtro.materiaPrimaId) cond.push(eq(compraMp.materiaPrimaId, filtro.materiaPrimaId));
  if (filtro.proveedorId) cond.push(eq(compraMp.proveedorId, filtro.proveedorId));
  const filas = await db
    .select({ c: compraMp, mpNombre: materiaPrima.nombre, mpTipo: materiaPrima.tipo, creador: usuario.nombre })
    .from(compraMp)
    .innerJoin(materiaPrima, eq(compraMp.materiaPrimaId, materiaPrima.id))
    .innerJoin(usuario, eq(compraMp.creadoPorId, usuario.id))
    .where(cond.length ? and(...cond) : undefined)
    .orderBy(desc(compraMp.fechaPedido), desc(compraMp.id));
  const ids = filas.map((f) => f.c.id);
  const entregas = ids.length
    ? await db
        .select({ e: compraEntrega, nombre: usuario.nombre })
        .from(compraEntrega)
        .innerJoin(usuario, eq(compraEntrega.usuarioId, usuario.id))
        .where(inArray(compraEntrega.compraId, ids))
        .orderBy(asc(compraEntrega.fecha))
    : [];
  const hoy = hoyISO();
  return filas.map(({ c, mpNombre, mpTipo, creador }) => {
    const mias = entregas.filter((x) => x.e.compraId === c.id);
    const recibido = mias.reduce((t, x) => t + aGramos(Number(x.e.kg)), 0) / 1000;
    const cantidad = Number(c.cantidadKg);
    const abierta = ABIERTAS.includes(c.estado);
    const entregadaEl = c.estado === "ENTREGADA" && mias.length ? diaAR(mias[mias.length - 1].e.fecha) : null;
    const atrasada = abierta && c.fechaEntregaEstimada != null && c.fechaEntregaEstimada < hoy;
    const diasDemora = c.fechaEntregaEstimada == null ? null : entregadaEl ? Math.max(0, dias(entregadaEl, c.fechaEntregaEstimada)) : atrasada ? dias(hoy, c.fechaEntregaEstimada) : null;
    return {
      id: c.id,
      materiaPrimaId: c.materiaPrimaId,
      materiaPrimaNombre: mpNombre,
      esMaster: mpTipo === "MASTER",
      proveedor: c.proveedor,
      proveedorId: c.proveedorId,
      precioKg: c.precioKg != null ? Number(c.precioKg) : null,
      montoTotal: c.montoTotal != null ? Number(c.montoTotal) : null,
      moneda: (MONEDAS as readonly string[]).includes(c.moneda) ? (c.moneda as Moneda) : "ARS",
      cantidadKg: cantidad,
      recibidoKg: recibido,
      pendienteKg: ABIERTAS.includes(c.estado) ? Math.max(0, (aGramos(cantidad) - aGramos(recibido)) / 1000) : 0,
      fechaPedido: c.fechaPedido,
      fechaEntregaEstimada: c.fechaEntregaEstimada,
      numeroOc: c.numeroOc,
      estado: c.estado,
      observaciones: c.observaciones,
      creadoPorNombre: creador,
      atrasada,
      entregadaEl,
      diasDemora,
      entregas: mias.map((x) => ({ id: x.e.id, fecha: x.e.fecha, kg: Number(x.e.kg), loteMpId: x.e.loteMpId, usuarioNombre: x.nombre, observaciones: x.e.observaciones })),
    };
  });
}

export type NuevaCompraInput = {
  materiaPrimaId: number;
  proveedor?: string | null;
  proveedorId?: number | null;
  precioKg?: number | null;
  montoTotal?: number | null;
  moneda?: Moneda;
  cantidadKg: number;
  fechaPedido: string;
  fechaEntregaEstimada?: string | null;
  numeroOc?: string | null;
  estado?: EstadoCompra;
  observaciones?: string | null;
};

export async function crearCompra(actor: Actor, input: NuevaCompraInput): Promise<Resultado & { id?: number }> {
  if (!puedeGestionarCompras(actor.rol)) return { error: "No tenés permiso para registrar compras." };
  if (!Number.isFinite(input.cantidadKg) || input.cantidadKg <= 0) return { error: "La cantidad tiene que ser mayor que cero." };
  if (!FECHA.test(input.fechaPedido)) return { error: "Falta la fecha del pedido." };
  if (input.fechaEntregaEstimada && !FECHA.test(input.fechaEntregaEstimada)) return { error: "Fecha de entrega inválida." };
  if (input.fechaEntregaEstimada && input.fechaEntregaEstimada < input.fechaPedido) return { error: "La entrega estimada no puede ser anterior al pedido." };
  const estado = input.estado ?? "PEDIDO";
  if (!["PEDIDO", "COMPRADO"].includes(estado)) return { error: "Una compra nueva arranca como «pedido» o «comprado»." };
  const [mp] = await db.select({ id: materiaPrima.id, nombre: materiaPrima.nombre, tipo: materiaPrima.tipo }).from(materiaPrima).where(eq(materiaPrima.id, input.materiaPrimaId));
  if (!mp) return { error: "Materia prima no encontrada." };
  if (mp.tipo === "MOLIENDA" || mp.tipo === "SOBRANTE") return { error: `${mp.nombre} no se compra: sale de la planta.` };
  const montos = montosDe(input.cantidadKg, input.precioKg, input.montoTotal);
  if (montos.error) return { error: montos.error };
  const prov = input.proveedorId ? await proveedorActivo(input.proveedorId) : null;
  if (prov && "error" in prov) return { error: prov.error };
  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(compraMp)
      .values({
        materiaPrimaId: mp.id,
        proveedor: prov?.nombre ?? (input.proveedor?.trim() || null),
        proveedorId: prov?.id ?? null,
        precioKg: montos.precioKg != null ? String(montos.precioKg) : null,
        montoTotal: montos.montoTotal != null ? String(montos.montoTotal) : null,
        moneda: input.moneda ?? "ARS",
        cantidadKg: String(input.cantidadKg),
        fechaPedido: input.fechaPedido,
        fechaEntregaEstimada: input.fechaEntregaEstimada || null,
        numeroOc: input.numeroOc?.trim() || null,
        estado,
        observaciones: input.observaciones?.trim() || null,
        creadoPorId: actor.id,
      })
      .returning();
    await registrarCambios(tx, actor.id, [{ entidad: "compra_mp", entidadId: c.id, campo: "alta", anterior: null, nuevo: `${mp.nombre} · ${input.cantidadKg} kg · ${ESTADO_COMPRA_LABEL[estado]}` }]);
    return { id: c.id };
  });
}

/**
 * Pedido de Materia prima a Compras (reunión 10/11/2026): la necesidad ya se
 * calcula sola, pero Materia prima puede pedir un material con la cantidad que
 * quiera. Queda como compra «pedida por Materia prima» y le llega el aviso a
 * Compras, que la activa (pasa a «pedido») o la descarta.
 */
export async function solicitarCompra(actor: Actor, input: { materiaPrimaId: number; cantidadKg: number; observaciones?: string | null }): Promise<Resultado & { id?: number }> {
  if (!puedeIngresarMateriaPrima(actor.rol)) return { error: "El pedido a Compras lo hace Materia prima." };
  if (!Number.isFinite(input.cantidadKg) || input.cantidadKg <= 0) return { error: "Indicá cuántos kg hacen falta." };
  const [mp] = await db.select({ id: materiaPrima.id, nombre: materiaPrima.nombre, tipo: materiaPrima.tipo }).from(materiaPrima).where(eq(materiaPrima.id, input.materiaPrimaId));
  if (!mp) return { error: "Materia prima no encontrada." };
  if (mp.tipo === "MOLIENDA" || mp.tipo === "SOBRANTE") return { error: `${mp.nombre} no se compra: sale de la planta.` };
  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(compraMp)
      .values({ materiaPrimaId: mp.id, cantidadKg: String(input.cantidadKg), fechaPedido: hoyISO(), estado: "SOLICITADA", observaciones: input.observaciones?.trim() || null, creadoPorId: actor.id })
      .returning();
    await registrarCambios(tx, actor.id, [{ entidad: "compra_mp", entidadId: c.id, campo: "alta", anterior: null, nuevo: `${mp.nombre} · ${input.cantidadKg} kg · ${ESTADO_COMPRA_LABEL.SOLICITADA}` }]);
    await crearAviso(tx, {
      tipo: "PEDIDO_MATERIA_PRIMA",
      destinoRol: "COMPRAS",
      mensaje: `Materia prima pide ${new Intl.NumberFormat("es-AR").format(input.cantidadKg)} kg de ${mp.nombre}${input.observaciones?.trim() ? ` (${input.observaciones.trim()})` : ""}. Activalo en Compras.`,
      creadoPorId: actor.id,
    });
    return { id: c.id };
  });
}

/** Nombre de la materia prima, para los avisos. */
async function nombreMp(ex: Pick<typeof db, "select">, id: number): Promise<string> {
  const [m] = await ex.select({ nombre: materiaPrima.nombre }).from(materiaPrima).where(eq(materiaPrima.id, id));
  return m?.nombre ?? "materia prima";
}
const kgTxt = (kg: number | string) => `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(Number(kg))} kg`;
const diaTxt = (f: string | null) => (f ? f.split("-").reverse().join("/") : null);

async function proveedorActivo(id: number): Promise<{ id: number; nombre: string } | { error: string }> {
  const [p] = await db.select({ id: proveedorT.id, nombre: proveedorT.nombre, activo: proveedorT.activo }).from(proveedorT).where(eq(proveedorT.id, id));
  if (!p) return { error: "Proveedor no encontrado." };
  if (!p.activo) return { error: `${p.nombre} está dado de baja como proveedor.` };
  return { id: p.id, nombre: p.nombre };
}

export type EjecutarCompraInput = {
  proveedorId: number;
  cantidadKg?: number;
  precioKg?: number | null;
  montoTotal?: number | null;
  moneda?: Moneda;
  fechaEntregaEstimada?: string | null;
  numeroOc?: string | null;
  estado?: "PEDIDO" | "COMPRADO";
  observaciones?: string | null;
};

/**
 * Compras ejecuta un pedido de Materia prima: elige el proveedor, confirma la
 * cantidad y carga montos, orden de compra y entrega estimada. La compra pasa
 * a «pedido» o «comprado» y desde ahí se sigue en Estado de compras.
 */
export async function ejecutarCompra(actor: Actor, id: number, input: EjecutarCompraInput): Promise<Resultado> {
  if (!puedeGestionarCompras(actor.rol)) return { error: "No tenés permiso para ejecutar compras." };
  if (!input.proveedorId) return { error: "Elegí el proveedor." };
  if (input.cantidadKg != null && (!Number.isFinite(input.cantidadKg) || input.cantidadKg <= 0)) return { error: "La cantidad tiene que ser mayor que cero." };
  if (input.fechaEntregaEstimada && !FECHA.test(input.fechaEntregaEstimada)) return { error: "Fecha de entrega inválida." };
  const estado = input.estado ?? "PEDIDO";
  if (!["PEDIDO", "COMPRADO"].includes(estado)) return { error: "La compra queda como «pedido» o «comprado»." };
  if (input.moneda && !MONEDAS.includes(input.moneda)) return { error: "Moneda inválida." };
  const prov = await proveedorActivo(input.proveedorId);
  if ("error" in prov) return { error: prov.error };
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(compraMp).where(eq(compraMp.id, id)).for("update");
    if (!c) return { error: "Pedido no encontrado." };
    if (c.estado !== "SOLICITADA") return { error: "Ese pedido ya se ejecutó o se descartó." };
    const cantidad = input.cantidadKg ?? Number(c.cantidadKg);
    if (input.fechaEntregaEstimada && input.fechaEntregaEstimada < hoyISO()) return { error: "La entrega estimada no puede ser anterior a hoy." };
    const montos = montosDe(cantidad, input.precioKg, input.montoTotal);
    if (montos.error) return { error: montos.error };
    const valores = {
      estado,
      proveedor: prov.nombre,
      proveedorId: prov.id,
      cantidadKg: String(cantidad),
      precioKg: montos.precioKg != null ? String(montos.precioKg) : null,
      montoTotal: montos.montoTotal != null ? String(montos.montoTotal) : null,
      moneda: input.moneda ?? "ARS",
      fechaPedido: hoyISO(),
      fechaEntregaEstimada: input.fechaEntregaEstimada || null,
      numeroOc: input.numeroOc?.trim() || null,
      observaciones: input.observaciones?.trim() || c.observaciones,
    };
    await tx.update(compraMp).set(valores).where(eq(compraMp.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "compra_mp", entidadId: id, campo: "estado", anterior: ESTADO_COMPRA_LABEL[c.estado], nuevo: ESTADO_COMPRA_LABEL[estado] },
      { entidad: "compra_mp", entidadId: id, campo: "proveedor", anterior: c.proveedor, nuevo: prov.nombre },
      { entidad: "compra_mp", entidadId: id, campo: "cantidad_kg", anterior: c.cantidadKg, nuevo: valores.cantidadKg },
      { entidad: "compra_mp", entidadId: id, campo: "monto_total", anterior: c.montoTotal, nuevo: valores.montoTotal ? `${valores.montoTotal} ${valores.moneda}` : null },
      { entidad: "compra_mp", entidadId: id, campo: "fecha_entrega_estimada", anterior: c.fechaEntregaEstimada, nuevo: valores.fechaEntregaEstimada },
      { entidad: "compra_mp", entidadId: id, campo: "numero_oc", anterior: c.numeroOc, nuevo: valores.numeroOc },
    ]);
    // Reunión 20/11/2026: Materia prima se entera de lo que pasa con su pedido.
    await crearAviso(tx, {
      tipo: "COMPRA_MP",
      destinoRol: "MATERIA_PRIMA",
      mensaje: `Compras ${estado === "COMPRADO" ? "compró" : "pidió"} ${kgTxt(valores.cantidadKg)} de ${await nombreMp(tx, c.materiaPrimaId)} a ${prov.nombre}${valores.fechaEntregaEstimada ? `: llega el ${diaTxt(valores.fechaEntregaEstimada)}` : " (sin fecha de entrega todavía)"} · compra #${id}.`,
      creadoPorId: actor.id,
    });
    return {};
  });
}

/** Pedidos de Materia prima que Compras todavía no activó. */
export async function comprasSolicitadas() {
  return (await listarCompras()).filter((c) => c.estado === "SOLICITADA");
}

/** Cambio de estado, fecha estimada u otros datos; queda en el historial. */
export async function actualizarCompra(
  actor: Actor,
  id: number,
  cambios: {
    estado?: EstadoCompra;
    fechaEntregaEstimada?: string | null;
    proveedor?: string | null;
    proveedorId?: number | null;
    precioKg?: number | null;
    montoTotal?: number | null;
    moneda?: Moneda;
    numeroOc?: string | null;
    cantidadKg?: number;
    observaciones?: string | null;
    motivo?: string | null;
  },
): Promise<Resultado> {
  if (!puedeGestionarCompras(actor.rol)) return { error: "No tenés permiso para modificar compras." };
  if (cambios.moneda && !MONEDAS.includes(cambios.moneda)) return { error: "Moneda inválida." };
  const prov = cambios.proveedorId ? await proveedorActivo(cambios.proveedorId) : null;
  if (prov && "error" in prov) return { error: prov.error };
  if (cambios.estado && !ESTADOS_COMPRA.includes(cambios.estado)) return { error: "Estado inválido." };
  if (cambios.fechaEntregaEstimada && !FECHA.test(cambios.fechaEntregaEstimada)) return { error: "Fecha de entrega inválida." };
  if (cambios.cantidadKg != null && (!Number.isFinite(cambios.cantidadKg) || cambios.cantidadKg <= 0)) return { error: "La cantidad tiene que ser mayor que cero." };
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(compraMp).where(eq(compraMp.id, id)).for("update");
    if (!c) return { error: "Compra no encontrada." };
    const [{ recibido }] = await tx.select({ recibido: sql<number>`coalesce(sum(${compraEntrega.kg}), 0)`.mapWith(Number) }).from(compraEntrega).where(eq(compraEntrega.compraId, id));
    const estado = cambios.estado ?? c.estado;
    if (estado === "ENTREGADA" && recibido <= 0) return { error: "Para darla por entregada tiene que haber al menos un ingreso imputado (Materia prima → Ingreso)." };
    if ((estado === "PEDIDO" || estado === "COMPRADO") && recibido > 0 && cambios.estado) return { error: "Ya tiene entregas: el estado es «parcialmente entregado», «con demora», «faltante» o «entregada»." };
    const cantidad = cambios.cantidadKg != null ? String(cambios.cantidadKg) : c.cantidadKg;
    if (Number(cantidad) < recibido) return { error: "La cantidad no puede quedar por debajo de lo ya recibido." };
    const tocaMontos = cambios.precioKg !== undefined || cambios.montoTotal !== undefined;
    const montos = tocaMontos
      ? montosDe(Number(cantidad), cambios.precioKg === undefined ? null : cambios.precioKg, cambios.montoTotal === undefined ? null : cambios.montoTotal)
      : { precioKg: c.precioKg != null ? Number(c.precioKg) : null, montoTotal: c.montoTotal != null ? Number(c.montoTotal) : null };
    if ("error" in montos && montos.error) return { error: montos.error };
    const valores = {
      estado,
      fechaEntregaEstimada: cambios.fechaEntregaEstimada === undefined ? c.fechaEntregaEstimada : cambios.fechaEntregaEstimada || null,
      proveedor: prov ? prov.nombre : cambios.proveedor === undefined ? c.proveedor : cambios.proveedor?.trim() || null,
      proveedorId: prov ? prov.id : cambios.proveedor !== undefined ? null : c.proveedorId,
      precioKg: montos.precioKg != null ? String(montos.precioKg) : null,
      montoTotal: montos.montoTotal != null ? String(montos.montoTotal) : null,
      moneda: cambios.moneda ?? c.moneda,
      numeroOc: cambios.numeroOc === undefined ? c.numeroOc : cambios.numeroOc?.trim() || null,
      cantidadKg: cantidad,
      observaciones: cambios.observaciones === undefined ? c.observaciones : cambios.observaciones?.trim() || null,
    };
    await tx.update(compraMp).set(valores).where(eq(compraMp.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "compra_mp", entidadId: id, campo: "estado", anterior: ESTADO_COMPRA_LABEL[c.estado], nuevo: ESTADO_COMPRA_LABEL[estado], motivo: cambios.motivo },
      { entidad: "compra_mp", entidadId: id, campo: "fecha_entrega_estimada", anterior: c.fechaEntregaEstimada, nuevo: valores.fechaEntregaEstimada, motivo: cambios.motivo },
      { entidad: "compra_mp", entidadId: id, campo: "proveedor", anterior: c.proveedor, nuevo: valores.proveedor, motivo: cambios.motivo },
      { entidad: "compra_mp", entidadId: id, campo: "numero_oc", anterior: c.numeroOc, nuevo: valores.numeroOc, motivo: cambios.motivo },
      { entidad: "compra_mp", entidadId: id, campo: "monto_total", anterior: c.montoTotal ? `${c.montoTotal} ${c.moneda}` : null, nuevo: valores.montoTotal ? `${valores.montoTotal} ${valores.moneda}` : null, motivo: cambios.motivo },
      { entidad: "compra_mp", entidadId: id, campo: "cantidad_kg", anterior: c.cantidadKg, nuevo: cantidad, motivo: cambios.motivo },
      { entidad: "compra_mp", entidadId: id, campo: "observaciones", anterior: c.observaciones, nuevo: valores.observaciones, motivo: cambios.motivo },
    ]);
    // Cambio de estado o de fecha de llegada: le avisa a Materia prima (reunión 20/11/2026).
    const cambioEstado = estado !== c.estado;
    const cambioFecha = valores.fechaEntregaEstimada !== c.fechaEntregaEstimada;
    if (cambioEstado || cambioFecha) {
      const partes = [
        cambioEstado ? `ahora está «${ESTADO_COMPRA_LABEL[estado]}»` : null,
        cambioFecha ? (valores.fechaEntregaEstimada ? `llega el ${diaTxt(valores.fechaEntregaEstimada)}` : "sin fecha de entrega") : null,
      ].filter(Boolean);
      await crearAviso(tx, {
        tipo: "COMPRA_MP",
        destinoRol: "MATERIA_PRIMA",
        mensaje: `La compra #${id} de ${await nombreMp(tx, c.materiaPrimaId)} (${kgTxt(cantidad)}${valores.proveedor ? `, ${valores.proveedor}` : ""}): ${partes.join(" y ")}${cambios.motivo?.trim() ? ` (${cambios.motivo.trim()})` : ""}.`,
        creadoPorId: actor.id,
      });
    }
    return {};
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Imputa un ingreso de proveedor a una compra (dentro de la transacción del
 * ingreso). No mueve stock: el stock lo movió el ingreso. Actualiza el estado.
 */
export async function imputarIngresoACompra(tx: Tx, actor: Actor, input: { compraId: number; materiaPrimaId: number; kg: number; loteMpId: number }): Promise<Resultado> {
  const [c] = await tx.select().from(compraMp).where(eq(compraMp.id, input.compraId)).for("update");
  if (!c) return { error: "Compra no encontrada." };
  if (!ABIERTAS.includes(c.estado)) return { error: "Esa compra ya está cerrada." };
  if (c.materiaPrimaId !== input.materiaPrimaId) return { error: "La compra elegida es de otro material." };
  await tx.insert(compraEntrega).values({ compraId: c.id, kg: String(input.kg), loteMpId: input.loteMpId, usuarioId: actor.id });
  const [{ recibido }] = await tx.select({ recibido: sql<number>`coalesce(sum(${compraEntrega.kg}), 0)`.mapWith(Number) }).from(compraEntrega).where(eq(compraEntrega.compraId, c.id));
  const estado: EstadoCompra = aGramos(recibido) >= aGramos(Number(c.cantidadKg)) ? "ENTREGADA" : "PARCIAL";
  await tx.update(compraMp).set({ estado }).where(eq(compraMp.id, c.id));
  await registrarCambios(tx, actor.id, [
    { entidad: "compra_mp", entidadId: c.id, campo: "entrega", anterior: null, nuevo: `${input.kg} kg (lote ${input.loteMpId})` },
    { entidad: "compra_mp", entidadId: c.id, campo: "estado", anterior: ESTADO_COMPRA_LABEL[c.estado], nuevo: ESTADO_COMPRA_LABEL[estado] },
  ]);
  // Compras no tiene que marcarla a mano: se entera de que llegó (reunión 20/11/2026).
  await crearAviso(tx, {
    tipo: "COMPRA_MP",
    destinoRol: "COMPRAS",
    mensaje: `Materia prima registró el ingreso de ${kgTxt(input.kg)} de ${await nombreMp(tx, c.materiaPrimaId)}${c.proveedor ? ` de ${c.proveedor}` : ""} (compra #${c.id}): quedó «${ESTADO_COMPRA_LABEL[estado]}»${estado === "PARCIAL" ? `, faltan ${kgTxt(Math.max(0, (aGramos(Number(c.cantidadKg)) - aGramos(recibido)) / 1000))}` : ""}.`,
    creadoPorId: actor.id,
  });
  return {};
}

/** Compras abiertas para elegir en el ingreso de proveedor. */
export async function comprasAbiertasDe(materiaPrimaId?: number) {
  return (await listarCompras({ abiertas: true, materiaPrimaId })).map((c) => ({
    id: c.id,
    materiaPrimaId: c.materiaPrimaId,
    materiaPrimaNombre: c.materiaPrimaNombre,
    proveedor: c.proveedor,
    pendienteKg: c.pendienteKg,
    etiqueta: `#${c.id} · ${c.materiaPrimaNombre} · ${kgTxt(c.pendienteKg)} pendientes${c.proveedor ? ` · ${c.proveedor}` : ""}${c.fechaEntregaEstimada ? ` · llega ${diaTxt(c.fechaEntregaEstimada)}` : ""}`,
  }));
}

export async function pendientePorMp(): Promise<Map<number, number>> {
  const res = new Map<number, number>();
  for (const c of await listarCompras({ abiertas: true })) res.set(c.materiaPrimaId, (aGramos(res.get(c.materiaPrimaId) ?? 0) + aGramos(c.pendienteKg)) / 1000);
  return res;
}
