/**
 * Compras de materia prima y master (mejoras 22/10, perfil Compras).
 *
 * Una compra se registra al pedirla y se sigue por estado. El material
 * ENTRA AL STOCK sólo por el ingreso de proveedor (Materia prima → Ingreso),
 * que se imputa a la compra: así cada kilo se cuenta una vez y la compra pasa
 * sola a «parcialmente entregada» o «entregada».
 */
import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { compraEntrega, compraMp, materiaPrima, producto, tanda, usuario } from "@/lib/db/schema";
import { puedeGestionarCompras } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { hoyISO } from "@/lib/format";
import { aGramos } from "@/lib/presentaciones";

export type EstadoCompra = (typeof compraMp.$inferSelect)["estado"];
export const ESTADOS_COMPRA: EstadoCompra[] = ["PEDIDO", "COMPRADO", "PARCIAL", "DEMORA", "FALTANTE", "ENTREGADA", "CANCELADA"];
export const ESTADO_COMPRA_LABEL: Record<EstadoCompra, string> = {
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

export type FilaCompra = {
  id: number;
  materiaPrimaId: number;
  materiaPrimaNombre: string;
  esMaster: boolean;
  proveedor: string | null;
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
  entregas: { id: number; fecha: Date; kg: number; loteMpId: number | null; usuarioNombre: string; observaciones: string | null }[];
};

export async function listarCompras(filtro: { abiertas?: boolean; materiaPrimaId?: number } = {}): Promise<FilaCompra[]> {
  const cond = [];
  if (filtro.abiertas) cond.push(inArray(compraMp.estado, ABIERTAS));
  if (filtro.materiaPrimaId) cond.push(eq(compraMp.materiaPrimaId, filtro.materiaPrimaId));
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
    return {
      id: c.id,
      materiaPrimaId: c.materiaPrimaId,
      materiaPrimaNombre: mpNombre,
      esMaster: mpTipo === "MASTER",
      proveedor: c.proveedor,
      cantidadKg: cantidad,
      recibidoKg: recibido,
      pendienteKg: ABIERTAS.includes(c.estado) ? Math.max(0, (aGramos(cantidad) - aGramos(recibido)) / 1000) : 0,
      fechaPedido: c.fechaPedido,
      fechaEntregaEstimada: c.fechaEntregaEstimada,
      numeroOc: c.numeroOc,
      estado: c.estado,
      observaciones: c.observaciones,
      creadoPorNombre: creador,
      atrasada: ABIERTAS.includes(c.estado) && c.fechaEntregaEstimada != null && c.fechaEntregaEstimada < hoy,
      entregas: mias.map((x) => ({ id: x.e.id, fecha: x.e.fecha, kg: Number(x.e.kg), loteMpId: x.e.loteMpId, usuarioNombre: x.nombre, observaciones: x.e.observaciones })),
    };
  });
}

export type NuevaCompraInput = {
  materiaPrimaId: number;
  proveedor?: string | null;
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
  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(compraMp)
      .values({
        materiaPrimaId: mp.id,
        proveedor: input.proveedor?.trim() || null,
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

/** Cambio de estado, fecha estimada u otros datos; queda en el historial. */
export async function actualizarCompra(
  actor: Actor,
  id: number,
  cambios: { estado?: EstadoCompra; fechaEntregaEstimada?: string | null; proveedor?: string | null; numeroOc?: string | null; cantidadKg?: number; observaciones?: string | null; motivo?: string | null },
): Promise<Resultado> {
  if (!puedeGestionarCompras(actor.rol)) return { error: "No tenés permiso para modificar compras." };
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
    const valores = {
      estado,
      fechaEntregaEstimada: cambios.fechaEntregaEstimada === undefined ? c.fechaEntregaEstimada : cambios.fechaEntregaEstimada || null,
      proveedor: cambios.proveedor === undefined ? c.proveedor : cambios.proveedor?.trim() || null,
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
      { entidad: "compra_mp", entidadId: id, campo: "cantidad_kg", anterior: c.cantidadKg, nuevo: cantidad, motivo: cambios.motivo },
      { entidad: "compra_mp", entidadId: id, campo: "observaciones", anterior: c.observaciones, nuevo: valores.observaciones, motivo: cambios.motivo },
    ]);
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
  return {};
}

/** Compras abiertas para elegir en el ingreso de proveedor. */
export async function comprasAbiertasDe(materiaPrimaId?: number) {
  return (await listarCompras({ abiertas: true, materiaPrimaId })).map((c) => ({ id: c.id, materiaPrimaId: c.materiaPrimaId, etiqueta: `#${c.id} · ${c.materiaPrimaNombre} · ${c.pendienteKg} kg pendientes${c.proveedor ? ` · ${c.proveedor}` : ""}` }));
}

export async function pendientePorMp(): Promise<Map<number, number>> {
  const res = new Map<number, number>();
  for (const c of await listarCompras({ abiertas: true })) res.set(c.materiaPrimaId, (aGramos(res.get(c.materiaPrimaId) ?? 0) + aGramos(c.pendienteKg)) / 1000);
  return res;
}

// ---------------------------------------------------------------------------
// Necesidad de materia prima
// ---------------------------------------------------------------------------

export type FilaNecesidad = {
  materiaPrimaId: number;
  nombre: string;
  esMaster: boolean;
  /** Para los pedidos a producir (planificados y por planificar). */
  pedidosKg: number;
  /** Para reponer el stock de producto terminado hasta el mínimo. */
  stockProductoKg: number;
  /** Objetivo de inventario de la propia MP (su mínimo). */
  objetivoMpKg: number;
  disponibleKg: number;
  compradoPendienteKg: number;
  /** pedidos + stock de producto + objetivo − disponible. */
  necesidadKg: number;
  /** necesidad − comprado pendiente de entrega. */
  proyectadaKg: number;
  /** Algún producto que aporta a esta fila tiene el peso sin confirmar. */
  estimado: boolean;
  /** Hay una compra de este material con demora o faltante en proveedor. */
  riesgo: string | null;
};

export type ResultadoNecesidad = {
  filas: FilaNecesidad[];
  /** Productos con demanda que no se pudieron convertir a kg. */
  sinConfigurar: { codigo: string; unidades: number; motivo: string }[];
  /** La mezcla del ciego no tiene proporción definida (afecta recetas sin bolsas de cada material). */
  avisos: string[];
};

/**
 * Cruza planificación, pedidos, mínimos de producto terminado, recetas, stock
 * de MP y compras en proceso. Las unidades de pisos se pasan a kg con la
 * receta y el peso por pieza: nunca se suman piezas con kilos. Si falta la
 * receta o el peso de un producto, ese producto se informa aparte en vez de
 * inventar un valor.
 */
export async function calcularNecesidad(): Promise<ResultadoNecesidad> {
  const { listarTandas, gruposParaPlanificar, materialParaPiezas, disponibleMp } = await import("@/lib/data/planificacion");
  const { recetasDe } = await import("@/lib/data/recetas");
  const { disponiblePorProducto } = await import("@/lib/data/stock");
  const { getDepositoNexaId } = await import("@/lib/data/depositos");

  const [tandas, grupos, prods] = await Promise.all([
    listarTandas(),
    gruposParaPlanificar(),
    db.select({ id: producto.id, codigo: producto.codigo, kg: producto.kgPorUnidad, minimo: producto.minimo, pesoOk: producto.pesoConfirmado }).from(producto).where(eq(producto.activo, true)),
  ]);
  const porProd = new Map(prods.map((p) => [p.id, p]));
  const filas = new Map<number, FilaNecesidad>();
  const sinConfigurar: ResultadoNecesidad["sinConfigurar"] = [];
  const fila = (id: number, nombre: string, esMaster: boolean) => {
    let f = filas.get(id);
    if (!f) {
      f = { materiaPrimaId: id, nombre, esMaster, pedidosKg: 0, stockProductoKg: 0, objetivoMpKg: 0, disponibleKg: 0, compradoPendienteKg: 0, necesidadKg: 0, proyectadaKg: 0, estimado: false, riesgo: null };
      filas.set(id, f);
    }
    return f;
  };
  const sumar = (m: { materiaPrimaId: number; nombre: string; esMaster: boolean; kg: number }, campo: "pedidosKg" | "stockProductoKg", estimado: boolean) => {
    const f = fila(m.materiaPrimaId, m.nombre, m.esMaster);
    f[campo] = (aGramos(f[campo]) + aGramos(m.kg)) / 1000;
    if (estimado) f.estimado = true;
  };

  // 1. Pedidos ya planificados (material de cada tanda activa).
  for (const t of tandas) {
    if (t.estado === "POSTERGADA") continue;
    const estimado = !porProd.get(t.productoId)?.pesoOk;
    for (const m of t.material) sumar({ materiaPrimaId: m.materiaPrimaId, nombre: m.nombre, esMaster: m.esMaster, kg: m.requeridoKg }, "pedidosKg", estimado);
  }
  // 2. Pedidos todavía sin planificar, y 3. reposición de stock de producto.
  const recetas = await recetasDe(prods.map((p) => p.id));
  const disponiblesPt = await disponiblePorProducto(await getDepositoNexaId(), prods.map((p) => p.id));
  const stockPlanificado = new Map<number, number>();
  for (const t of await db.select({ productoId: tanda.productoId, n: sql<number>`sum(${tanda.cantidadStock})`.mapWith(Number) }).from(tanda).where(notInArray(tanda.estado, ["COMPLETADA", "CANCELADA"])).groupBy(tanda.productoId)) {
    stockPlanificado.set(t.productoId, t.n);
  }
  const convertir = (productoId: number, unidades: number, campo: "pedidosKg" | "stockProductoKg", motivoUso: string) => {
    if (unidades <= 0) return;
    const p = porProd.get(productoId);
    if (!p) return;
    const r = recetas.get(productoId);
    const kg = p.kg != null && Number(p.kg) > 0 ? Number(p.kg) : null;
    const mat = materialParaPiezas(unidades, kg, r?.REGIMEN ?? null, null);
    if (!mat) {
      sinConfigurar.push({ codigo: p.codigo, unidades, motivo: `${motivoUso}: ${!r?.REGIMEN ? "sin receta de carga" : "sin peso por pieza"}` });
      return;
    }
    for (const [id, m] of mat.porMp) sumar({ materiaPrimaId: id, nombre: m.nombre, esMaster: m.esMaster, kg: m.kg }, campo, !p.pesoOk);
  };
  for (const g of grupos) convertir(g.productoId, g.aPlanificar, "pedidosKg", "pedidos sin planificar");
  for (const p of prods) {
    if (p.minimo == null) continue;
    const falta = p.minimo - (disponiblesPt.get(p.id) ?? 0) - (stockPlanificado.get(p.id) ?? 0);
    convertir(p.id, Math.max(0, Math.ceil(falta)), "stockProductoKg", "stock bajo el mínimo");
  }

  // 4. Objetivo de inventario de cada MP (su mínimo) y materiales con mínimo aunque no tengan demanda.
  const mps = await db.select({ id: materiaPrima.id, nombre: materiaPrima.nombre, tipo: materiaPrima.tipo, minimo: materiaPrima.minimo }).from(materiaPrima).where(and(eq(materiaPrima.activo, true), inArray(materiaPrima.tipo, ["VIRGEN", "MASTER"])));
  for (const m of mps) {
    const min = m.minimo != null ? Number(m.minimo) : 0;
    if (min > 0 || filas.has(m.id)) fila(m.id, m.nombre, m.tipo === "MASTER").objetivoMpKg = min;
  }

  const ids = [...filas.keys()];
  const [disp, pendientes, compras] = await Promise.all([disponibleMp(ids), pendientePorMp(), listarCompras({ abiertas: true })]);
  for (const f of filas.values()) {
    const d = disp.get(f.materiaPrimaId) ?? { deposito: 0, pie: 0 };
    f.disponibleKg = d.deposito + d.pie;
    f.compradoPendienteKg = pendientes.get(f.materiaPrimaId) ?? 0;
    const g = aGramos(f.pedidosKg) + aGramos(f.stockProductoKg) + aGramos(f.objetivoMpKg) - aGramos(f.disponibleKg);
    f.necesidadKg = Math.max(0, g) / 1000;
    f.proyectadaKg = Math.max(0, g - aGramos(f.compradoPendienteKg)) / 1000;
    const problema = compras.find((c) => c.materiaPrimaId === f.materiaPrimaId && (c.estado === "DEMORA" || c.estado === "FALTANTE" || c.atrasada));
    if (problema) {
      f.riesgo = problema.estado === "FALTANTE"
        ? `Faltante en proveedor (compra #${problema.id})${f.esMaster ? ": evaluar un master de tono parecido de otro proveedor (no se reemplaza solo)" : ""}`
        : `Compra #${problema.id} con demora${problema.fechaEntregaEstimada ? ` (entrega estimada ${problema.fechaEntregaEstimada})` : ""}`;
    }
  }
  const avisos: string[] = [];
  if (prods.some((p) => !p.pesoOk)) avisos.push("Los pesos por pieza todavía no están confirmados por el cliente: las cantidades marcadas como «estimado» pueden cambiar.");
  return {
    filas: [...filas.values()].sort((a, b) => b.proyectadaKg - a.proyectadaKg || b.necesidadKg - a.necesidadKg || a.nombre.localeCompare(b.nombre)),
    sinConfigurar,
    avisos,
  };
}
