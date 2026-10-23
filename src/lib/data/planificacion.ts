/**
 * Planificación de la producción (minuta 15/10/2026 — prioridad 1).
 *
 * 1. Agrupación automática: los renglones pendientes de los pedidos se agrupan
 *    por PRODUCTO (que en NEXA ya es familia + tipo + color + proveedor del
 *    master), con el total, el stock, lo cubierto, el faltante y lo que falta
 *    planificar. La cobertura de stock es la misma de pedidos (por prioridad).
 * 2. Tandas: el Encargado arma una tanda con los pedidos que quiere cubrir
 *    (todos o algunos, para "cortar" la tanda e intercalar otros colores) y
 *    una cantidad adicional para stock. La relación con cada pedido no se
 *    pierde (`tanda_pedido`). También hay tandas sólo para stock.
 * 3. Secuencia: las tandas se ordenan a mano (subir/bajar), se postergan, se
 *    asignan a inyectora, fecha y turno. Se avisan los cambios de matriz y de
 *    color entre tandas seguidas de la misma inyectora y las entregas
 *    comprometidas próximas que todavía no están cubiertas. No hay calendario
 *    de matrices: la regla está pendiente de definición.
 * 4. Inicio: desde la tanda se inicia la producción (partida automática,
 *    pedidos y cantidad objetivo precargados).
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  cicloProduccion,
  cliente,
  color,
  pedido,
  pedidoLinea,
  producto,
  saldo,
  tanda,
  tandaPedido,
  turnoProduccion,
  eventoProduccion,
} from "@/lib/db/schema";
import { getDepositoNexaId, getDepositoPieId } from "@/lib/data/depositos";
import { coberturaPorLinea } from "@/lib/data/pedidos";
import { puedeOperarTaller, puedePlanificar } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { crearCiclo, partidasAbiertasDe } from "@/lib/data/produccion";
import { recetasDe, type Receta } from "@/lib/data/recetas";
import { INYECTORA_BALDOSAS, resolverInyectora } from "@/lib/inyectoras";
import { obtenerRetirosMaquina } from "@/lib/data/maquina";
import { hoyISO } from "@/lib/format";
import { aGramos } from "@/lib/presentaciones";

export type Turno = "MANANA" | "TARDE" | "NOCHE";
export const TURNOS: { valor: Turno; etiqueta: string }[] = [
  { valor: "MANANA", etiqueta: "Mañana" },
  { valor: "TARDE", etiqueta: "Tarde" },
  { valor: "NOCHE", etiqueta: "Noche" },
];
export const etiquetaTurno = (t: string | null | undefined) => TURNOS.find((x) => x.valor === t)?.etiqueta ?? "—";

/** Estados en los que una tanda todavía "toma" unidades de los pedidos. */
const ACTIVAS = ["PLANIFICADA", "EN_CURSO", "POSTERGADA"] as const;

const TIPO_LABEL: Record<string, string> = {
  UNICO: "",
  TRAMA: "trama",
  MONEDA: "moneda",
  BORDE: "borde",
  ESQUINERO: "esquinero",
  RAMPA: "rampa",
};

/** Matriz que usa un producto: familia + tipo (rejilla, ciego, ciego moneda,
 *  ciego trama, rampa…). El color no cambia la matriz. */
export function matrizDe(p: { familia: string; tipo: string }): string {
  const fam = p.familia === "REJILLA" ? "Rejilla" : "Ciego";
  return [fam, TIPO_LABEL[p.tipo] ?? p.tipo.toLowerCase()].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Alertas de entrega
// ---------------------------------------------------------------------------

export type AlertaEntrega = { nivel: "vencida" | "hoy" | "manana" | "semana"; dias: number; texto: string } | null;

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

/** Entrega comprometida dentro de la semana: se avisa si todavía falta. */
export function alertaEntrega(fechaEntrega: string | null, hoy = hoyISO()): AlertaEntrega {
  if (!fechaEntrega) return null;
  const d = diasEntre(hoy, fechaEntrega);
  if (d < 0) return { nivel: "vencida", dias: d, texto: `Entrega vencida hace ${-d} día${d === -1 ? "" : "s"}` };
  if (d === 0) return { nivel: "hoy", dias: d, texto: "Hay que entregar hoy" };
  if (d === 1) return { nivel: "manana", dias: d, texto: "Hay que entregar mañana" };
  if (d <= 7) return { nivel: "semana", dias: d, texto: `Entrega en ${d} días` };
  return null;
}

// ---------------------------------------------------------------------------
// Agrupación automática
// ---------------------------------------------------------------------------

export type LineaPendiente = {
  pedidoLineaId: number;
  pedidoId: number;
  clienteNombre: string;
  fechaPedido: string;
  fechaEntrega: string | null;
  prioridad: number;
  pendiente: number;
  cubiertoStock: number;
  faltante: number;
  planificado: number;
  /** Faltante que todavía no está en ninguna tanda. */
  aPlanificar: number;
  alerta: AlertaEntrega;
};

export type GrupoPlanificacion = {
  productoId: number;
  codigo: string;
  descripcion: string;
  colorNombre: string | null;
  matriz: string;
  esAccesorio: boolean;
  pendiente: number;
  stock: number;
  faltante: number;
  planificado: number;
  aPlanificar: number;
  lineas: LineaPendiente[];
  alerta: AlertaEntrega;
  tieneReceta: boolean;
};

const NIVEL_ORDEN = { vencida: 0, hoy: 1, manana: 2, semana: 3 } as const;
function peorAlerta(a: AlertaEntrega[]): AlertaEntrega {
  return a.filter(Boolean).sort((x, y) => NIVEL_ORDEN[x!.nivel] - NIVEL_ORDEN[y!.nivel] || x!.dias - y!.dias)[0] ?? null;
}

/** Unidades de cada renglón ya tomadas por tandas activas. */
async function planificadoPorLinea(lineaIds: number[], excluirTandaId?: number): Promise<Map<number, number>> {
  if (lineaIds.length === 0) return new Map();
  const filas = await db
    .select({ lineaId: tandaPedido.pedidoLineaId, total: sql<number>`coalesce(sum(${tandaPedido.cantidad}), 0)`.mapWith(Number) })
    .from(tandaPedido)
    .innerJoin(tanda, eq(tandaPedido.tandaId, tanda.id))
    .where(
      and(
        inArray(tandaPedido.pedidoLineaId, lineaIds),
        inArray(tanda.estado, [...ACTIVAS]),
        excluirTandaId ? sql`${tanda.id} <> ${excluirTandaId}` : undefined,
      ),
    )
    .groupBy(tandaPedido.pedidoLineaId);
  return new Map(filas.map((f) => [f.lineaId, f.total]));
}

/**
 * Pedidos pendientes agrupados por producto y color. Sólo renglones con
 * producto asignado, de pedidos abiertos y no archivados. Ordenado por el
 * pedido más antiguo de cada grupo (urgentes primero), con su peor alerta.
 */
export async function gruposParaPlanificar(hoy = hoyISO()): Promise<GrupoPlanificacion[]> {
  const depositoId = await getDepositoNexaId();
  const lineas = await db
    .select({
      pedidoLineaId: pedidoLinea.id,
      pedidoId: pedido.id,
      productoId: pedidoLinea.productoId,
      clienteNombre: cliente.nombre,
      fechaPedido: pedido.fechaPedido,
      fechaEntrega: pedido.fechaEntregaPactada,
      prioridad: pedido.prioridad,
      pendiente: sql<number>`${pedidoLinea.unidadesPedidas} - ${pedidoLinea.unidadesDespachadas}`.mapWith(Number),
    })
    .from(pedidoLinea)
    .innerJoin(pedido, eq(pedidoLinea.pedidoId, pedido.id))
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .where(
      and(
        sql`${pedido.estado} not in ('ENTREGADO', 'CANCELADO')`,
        eq(pedido.archivado, false),
        sql`${pedidoLinea.productoId} is not null`,
        sql`${pedidoLinea.unidadesPedidas} > ${pedidoLinea.unidadesDespachadas}`,
      ),
    )
    .orderBy(asc(pedido.prioridad), asc(pedido.fechaPedido), asc(pedido.id), asc(pedidoLinea.id));
  if (lineas.length === 0) return [];
  const productoIds = [...new Set(lineas.map((l) => l.productoId!))];
  const [cobertura, planificado, prods, saldos, recetas] = await Promise.all([
    coberturaPorLinea(productoIds),
    planificadoPorLinea(lineas.map((l) => l.pedidoLineaId)),
    db
      .select({ id: producto.id, codigo: producto.codigo, descripcion: producto.descripcion, familia: producto.familia, tipo: producto.tipo, esAccesorio: producto.esAccesorio, colorNombre: color.nombre })
      .from(producto)
      .leftJoin(color, eq(producto.colorId, color.id))
      .where(inArray(producto.id, productoIds)),
    db.select({ productoId: saldo.productoId, cantidad: saldo.cantidad }).from(saldo).where(and(eq(saldo.depositoId, depositoId), inArray(saldo.productoId, productoIds))),
    recetasDe(productoIds),
  ]);
  const grupos = new Map<number, GrupoPlanificacion>();
  for (const l of lineas) {
    const p = prods.find((x) => x.id === l.productoId)!;
    const cob = cobertura.get(l.pedidoLineaId) ?? { pendiente: l.pendiente, cubierto: 0, faltaProducir: l.pendiente };
    const plan = Math.min(planificado.get(l.pedidoLineaId) ?? 0, cob.faltaProducir);
    const linea: LineaPendiente = {
      pedidoLineaId: l.pedidoLineaId,
      pedidoId: l.pedidoId,
      clienteNombre: l.clienteNombre,
      fechaPedido: l.fechaPedido,
      fechaEntrega: l.fechaEntrega,
      prioridad: l.prioridad,
      pendiente: l.pendiente,
      cubiertoStock: cob.cubierto,
      faltante: cob.faltaProducir,
      planificado: plan,
      aPlanificar: Math.max(0, cob.faltaProducir - plan),
      alerta: cob.faltaProducir > 0 ? alertaEntrega(l.fechaEntrega, hoy) : null,
    };
    const g =
      grupos.get(p.id) ??
      ({
        productoId: p.id,
        codigo: p.codigo,
        descripcion: p.descripcion,
        colorNombre: p.colorNombre,
        matriz: matrizDe(p),
        esAccesorio: p.esAccesorio,
        pendiente: 0,
        stock: Number(saldos.find((s) => s.productoId === p.id)?.cantidad ?? 0),
        faltante: 0,
        planificado: 0,
        aPlanificar: 0,
        lineas: [],
        alerta: null,
        tieneReceta: Boolean(recetas.get(p.id)?.REGIMEN),
      } satisfies GrupoPlanificacion);
    g.lineas.push(linea);
    g.pendiente += linea.pendiente;
    g.faltante += linea.faltante;
    g.planificado += linea.planificado;
    g.aPlanificar += linea.aPlanificar;
    grupos.set(p.id, g);
  }
  for (const g of grupos.values()) g.alerta = peorAlerta(g.lineas.map((l) => (l.aPlanificar > 0 ? l.alerta : null)));
  return [...grupos.values()];
}

// ---------------------------------------------------------------------------
// Tandas
// ---------------------------------------------------------------------------

export type MaterialRequerido = {
  materiaPrimaId: number;
  nombre: string;
  esMaster: boolean;
  requeridoKg: number;
  disponibleKg: number;
  faltanteKg: number;
};

export type TandaVista = {
  id: number;
  orden: number;
  estado: (typeof tanda.$inferSelect)["estado"];
  productoId: number;
  codigo: string;
  descripcion: string;
  colorNombre: string | null;
  colorId: number;
  matriz: string;
  esAccesorio: boolean;
  kgPorUnidad: number | null;
  cantidadPedidos: number;
  cantidadStock: number;
  objetivo: number;
  producido: number;
  inyectora: string | null;
  fecha: string | null;
  turno: Turno | null;
  usarArranque: boolean;
  observaciones: string | null;
  postergadaMotivo: string | null;
  cicloId: number | null;
  pedidos: { pedidoId: number; pedidoLineaId: number; clienteNombre: string; cantidad: number; fechaPedido: string; fechaEntrega: string | null; prioridad: number; alerta: AlertaEntrega }[];
  receta: Receta | null;
  recetaArranque: Receta | null;
  /** Cargas de receta necesarias para lo que falta producir (redondeo hacia arriba). */
  cargas: number | null;
  material: MaterialRequerido[];
  avisos: string[];
  alerta: AlertaEntrega;
};

/** Piezas producidas hasta ahora por la producción de cada tanda (turnos cerrados o cierre). */
async function producidoPorCiclo(cicloIds: number[]): Promise<Map<number, number>> {
  if (cicloIds.length === 0) return new Map();
  const ciclos = await db
    .select({ id: cicloProduccion.id, producidas: cicloProduccion.piezasProducidas, fin: cicloProduccion.fechaFin })
    .from(cicloProduccion)
    .where(inArray(cicloProduccion.id, cicloIds));
  const turnos = await db
    .select({ cicloId: turnoProduccion.cicloId, total: sql<number>`coalesce(sum(${turnoProduccion.piezas}), 0)`.mapWith(Number) })
    .from(turnoProduccion)
    .where(and(inArray(turnoProduccion.cicloId, cicloIds), eq(turnoProduccion.estado, "CERRADO")))
    .groupBy(turnoProduccion.cicloId);
  return new Map(ciclos.map((c) => [c.id, c.fin ? (c.producidas ?? 0) : (turnos.find((t) => t.cicloId === c.id)?.total ?? 0)]));
}

/** Disponible por material: depósito + pie de máquina (lo que todavía no entró a la tolva). */
export async function disponibleMp(mpIds: number[]): Promise<Map<number, { deposito: number; pie: number }>> {
  if (mpIds.length === 0) return new Map();
  const [dep, pie] = await Promise.all([getDepositoNexaId(), getDepositoPieId()]);
  const filas = await db
    .select({ depositoId: saldo.depositoId, mp: saldo.materiaPrimaId, cantidad: saldo.cantidad })
    .from(saldo)
    .where(and(inArray(saldo.materiaPrimaId, mpIds), inArray(saldo.depositoId, [dep, pie])));
  const res = new Map<number, { deposito: number; pie: number }>();
  for (const id of mpIds) res.set(id, { deposito: 0, pie: 0 });
  for (const f of filas) {
    const r = res.get(f.mp!)!;
    if (f.depositoId === dep) r.deposito = Number(f.cantidad);
    else r.pie = Number(f.cantidad);
  }
  return res;
}

/**
 * Material que pide una cantidad de piezas según la receta de régimen: las
 * piezas × peso por pieza dan los kg de material base; con la receta se sabe
 * cuántas cargas son y cuánto de cada material lleva cada carga. Sin receta o
 * sin peso por pieza no se calcula (no se inventa).
 */
export function materialParaPiezas(
  piezas: number,
  kgPorUnidad: number | null,
  receta: Receta | null,
  arranque: Receta | null,
): { cargas: number; porMp: Map<number, { nombre: string; esMaster: boolean; kg: number }> } | null {
  if (!receta || !kgPorUnidad || receta.kgVirgen <= 0 || piezas <= 0) return null;
  const cargas = Math.ceil((piezas * kgPorUnidad) / receta.kgVirgen - 1e-9);
  const porMp = new Map<number, { nombre: string; esMaster: boolean; kg: number }>();
  const sumar = (r: Receta, veces: number) => {
    for (const i of r.items) {
      const a = porMp.get(i.materiaPrimaId) ?? { nombre: i.materiaPrimaNombre, esMaster: i.esMaster, kg: 0 };
      a.kg = (aGramos(a.kg) + aGramos(i.kg) * veces) / 1000;
      porMp.set(i.materiaPrimaId, a);
    }
  };
  // La primera carga, si hay cambio de color, es la reforzada.
  if (arranque && cargas > 0) {
    sumar(arranque, 1);
    sumar(receta, cargas - 1);
  } else {
    sumar(receta, cargas);
  }
  return { cargas, porMp };
}

export async function listarTandas(opts: { incluirCerradas?: boolean; hoy?: string } = {}): Promise<TandaVista[]> {
  const hoy = opts.hoy ?? hoyISO();
  const filas = await db
    .select({
      t: tanda,
      codigo: producto.codigo,
      descripcion: producto.descripcion,
      familia: producto.familia,
      tipo: producto.tipo,
      esAccesorio: producto.esAccesorio,
      kgPorUnidad: producto.kgPorUnidad,
      colorId: producto.colorId,
      colorNombre: color.nombre,
    })
    .from(tanda)
    .innerJoin(producto, eq(tanda.productoId, producto.id))
    .leftJoin(color, eq(producto.colorId, color.id))
    .where(opts.incluirCerradas ? undefined : inArray(tanda.estado, [...ACTIVAS]))
    .orderBy(asc(tanda.orden), asc(tanda.id));
  if (filas.length === 0) return [];
  const ids = filas.map((f) => f.t.id);
  const [peds, recetas, producido] = await Promise.all([
    db
      .select({
        tandaId: tandaPedido.tandaId,
        pedidoId: tandaPedido.pedidoId,
        pedidoLineaId: tandaPedido.pedidoLineaId,
        cantidad: tandaPedido.cantidad,
        clienteNombre: cliente.nombre,
        fechaPedido: pedido.fechaPedido,
        fechaEntrega: pedido.fechaEntregaPactada,
        prioridad: pedido.prioridad,
      })
      .from(tandaPedido)
      .innerJoin(pedido, eq(tandaPedido.pedidoId, pedido.id))
      .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
      .where(inArray(tandaPedido.tandaId, ids))
      .orderBy(asc(pedido.prioridad), asc(pedido.fechaPedido), asc(pedido.id)),
    recetasDe([...new Set(filas.map((f) => f.t.productoId))]),
    producidoPorCiclo(filas.map((f) => f.t.cicloId).filter((x): x is number => x != null)),
  ]);

  const vistas: TandaVista[] = filas.map((f) => {
    const r = recetas.get(f.t.productoId) ?? {};
    const objetivo = f.t.cantidadPedidos + f.t.cantidadStock;
    const hecho = f.t.cicloId ? (producido.get(f.t.cicloId) ?? 0) : 0;
    const kg = f.kgPorUnidad != null && Number(f.kgPorUnidad) > 0 ? Number(f.kgPorUnidad) : null;
    const resto = Math.max(0, objetivo - hecho);
    const calc = materialParaPiezas(resto, kg, r.REGIMEN ?? null, f.t.usarArranque && !f.t.cicloId ? (r.ARRANQUE ?? null) : null);
    const pedidos = peds
      .filter((p) => p.tandaId === f.t.id)
      .map((p) => ({ ...p, alerta: f.t.estado === "COMPLETADA" ? null : alertaEntrega(p.fechaEntrega, hoy) }));
    return {
      id: f.t.id,
      orden: f.t.orden,
      estado: f.t.estado,
      productoId: f.t.productoId,
      codigo: f.codigo,
      descripcion: f.descripcion,
      colorNombre: f.colorNombre,
      colorId: f.colorId,
      matriz: matrizDe(f),
      esAccesorio: f.esAccesorio,
      kgPorUnidad: kg,
      cantidadPedidos: f.t.cantidadPedidos,
      cantidadStock: f.t.cantidadStock,
      objetivo,
      producido: hecho,
      inyectora: f.t.inyectora,
      fecha: f.t.fecha,
      turno: f.t.turno,
      usarArranque: f.t.usarArranque,
      observaciones: f.t.observaciones,
      postergadaMotivo: f.t.postergadaMotivo,
      cicloId: f.t.cicloId,
      pedidos,
      receta: r.REGIMEN ?? null,
      recetaArranque: r.ARRANQUE ?? null,
      cargas: calc?.cargas ?? null,
      material: calc
        ? [...calc.porMp.entries()].map(([id, m]) => ({ materiaPrimaId: id, nombre: m.nombre, esMaster: m.esMaster, requeridoKg: m.kg, disponibleKg: 0, faltanteKg: 0 }))
        : [],
      avisos: [],
      alerta: peorAlerta(pedidos.map((p) => p.alerta)),
    };
  });

  // Disponibilidad de material acumulada en el orden de la secuencia: las
  // primeras tandas consumen primero.
  const mpIds = [...new Set(vistas.flatMap((v) => v.material.map((m) => m.materiaPrimaId)))];
  const disp = await disponibleMp(mpIds);
  const libre = new Map([...disp.entries()].map(([id, d]) => [id, d.deposito + d.pie]));
  for (const v of vistas) {
    if (v.estado === "POSTERGADA" || v.estado === "COMPLETADA" || v.estado === "CANCELADA") continue;
    for (const m of v.material) {
      const l = libre.get(m.materiaPrimaId) ?? 0;
      m.disponibleKg = Math.max(0, l);
      m.faltanteKg = Math.max(0, (aGramos(m.requeridoKg) - aGramos(Math.max(0, l))) / 1000);
      libre.set(m.materiaPrimaId, l - m.requeridoKg);
    }
  }

  // Avisos de secuencia por inyectora: cambio de matriz o de color respecto
  // de la tanda anterior en la misma máquina.
  const ultimaPorMaquina = new Map<string, TandaVista>();
  for (const v of vistas) {
    if (v.estado === "POSTERGADA") v.avisos.push(`Postergada${v.postergadaMotivo ? `: ${v.postergadaMotivo}` : ""}`);
    if (!v.receta) v.avisos.push("Sin receta de carga: definila en Configuración → Recetas de carga.");
    else if (!v.kgPorUnidad) v.avisos.push("El producto no tiene peso por pieza: no se puede calcular el material.");
    if (v.material.some((m) => m.faltanteKg > 0)) v.avisos.push("Falta material para esta tanda (ver necesidad de compra).");
    if (v.estado === "POSTERGADA" || !v.inyectora) continue;
    const prev = ultimaPorMaquina.get(v.inyectora);
    if (prev) {
      if (prev.matriz !== v.matriz) v.avisos.push(`Cambio de matriz en la inyectora ${v.inyectora}: ${prev.matriz} → ${v.matriz}.`);
      else if (prev.colorId !== v.colorId) v.avisos.push(`Cambio de color: ${prev.colorNombre ?? "—"} → ${v.colorNombre ?? "—"}${v.recetaArranque ? " (hay receta de arranque)" : ""}.`);
    }
    ultimaPorMaquina.set(v.inyectora, v);
  }
  return vistas;
}

export type NuevaTandaInput = {
  productoId: number;
  lineas: { pedidoLineaId: number; cantidad: number }[];
  cantidadStock?: number;
  inyectora?: string | null;
  fecha?: string | null;
  turno?: Turno | null;
  usarArranque?: boolean;
  observaciones?: string | null;
};

/**
 * Arma una tanda. Cada renglón no puede tomar más de lo que le falta
 * planificar (faltante después del stock, menos lo que ya está en otras
 * tandas): así un pedido no se planifica dos veces.
 */
export async function crearTanda(actor: Actor, input: NuevaTandaInput): Promise<Resultado & { id?: number }> {
  if (!puedePlanificar(actor.rol)) return { error: "No tenés permiso para planificar la producción." };
  const stockExtra = input.cantidadStock ?? 0;
  if (!Number.isInteger(stockExtra) || stockExtra < 0) return { error: "La cantidad para stock tiene que ser un número entero (0 o más)." };
  const lineas = input.lineas.filter((l) => l.cantidad > 0);
  if (lineas.some((l) => !Number.isInteger(l.cantidad))) return { error: "Las cantidades van en unidades enteras." };
  if (lineas.length === 0 && stockExtra === 0) return { error: "Elegí al menos un pedido o una cantidad para stock." };
  const [prod] = await db.select({ id: producto.id, esAccesorio: producto.esAccesorio, activo: producto.activo }).from(producto).where(eq(producto.id, input.productoId));
  if (!prod) return { error: "Producto no encontrado." };
  let inyectora: string | null = null;
  if (input.inyectora) {
    const r = resolverInyectora(prod.esAccesorio, input.inyectora);
    if ("error" in r) return r;
    inyectora = r.inyectora;
  } else if (!prod.esAccesorio) {
    inyectora = INYECTORA_BALDOSAS; // las baldosas van siempre a la 8
  }

  if (lineas.length > 0) {
    const grupos = await gruposParaPlanificar();
    const g = grupos.find((x) => x.productoId === input.productoId);
    for (const l of lineas) {
      const lp = g?.lineas.find((x) => x.pedidoLineaId === l.pedidoLineaId);
      if (!lp) return { error: "Uno de los renglones elegidos no es de este producto o ya no está pendiente." };
      if (l.cantidad > lp.aPlanificar) {
        return { error: `El pedido #${lp.pedidoId} tiene ${lp.aPlanificar} unidades sin planificar; no se le pueden asignar ${l.cantidad}.` };
      }
    }
  }

  return db.transaction(async (tx) => {
    const [{ max }] = await tx.select({ max: sql<number>`coalesce(max(${tanda.orden}), 0)`.mapWith(Number) }).from(tanda);
    const lineasDb = lineas.length
      ? await tx.select({ id: pedidoLinea.id, pedidoId: pedidoLinea.pedidoId }).from(pedidoLinea).where(inArray(pedidoLinea.id, lineas.map((l) => l.pedidoLineaId)))
      : [];
    const cantidadPedidos = lineas.reduce((t, l) => t + l.cantidad, 0);
    const [t] = await tx
      .insert(tanda)
      .values({
        productoId: input.productoId,
        cantidadPedidos,
        cantidadStock: stockExtra,
        orden: max + 1,
        inyectora,
        fecha: input.fecha || null,
        turno: input.turno ?? null,
        usarArranque: Boolean(input.usarArranque),
        observaciones: input.observaciones?.trim() || null,
        creadoPorId: actor.id,
      })
      .returning();
    if (lineas.length) {
      await tx.insert(tandaPedido).values(
        lineas.map((l) => ({ tandaId: t.id, pedidoLineaId: l.pedidoLineaId, pedidoId: lineasDb.find((x) => x.id === l.pedidoLineaId)!.pedidoId, cantidad: l.cantidad })),
      );
    }
    await registrarCambios(tx, actor.id, [
      { entidad: "tanda", entidadId: t.id, campo: "alta", anterior: null, nuevo: `${cantidadPedidos} para pedidos + ${stockExtra} para stock` },
    ]);
    return { id: t.id };
  });
}

async function tandaEditable(id: number) {
  const [t] = await db.select().from(tanda).where(eq(tanda.id, id));
  if (!t) return { error: "Tanda no encontrada." } as const;
  if (t.estado === "COMPLETADA" || t.estado === "CANCELADA") return { error: "La tanda ya está cerrada." } as const;
  return { t } as const;
}

export async function actualizarTanda(
  actor: Actor,
  id: number,
  input: { inyectora?: string | null; fecha?: string | null; turno?: Turno | null; cantidadStock?: number; usarArranque?: boolean; observaciones?: string | null },
): Promise<Resultado> {
  if (!puedePlanificar(actor.rol)) return { error: "No tenés permiso para planificar la producción." };
  const r = await tandaEditable(id);
  if ("error" in r) return r;
  const { t } = r;
  const [prod] = await db.select({ esAccesorio: producto.esAccesorio }).from(producto).where(eq(producto.id, t.productoId));
  let inyectora = t.inyectora;
  if (input.inyectora !== undefined) {
    if (input.inyectora) {
      const iny = resolverInyectora(prod.esAccesorio, input.inyectora);
      if ("error" in iny) return iny;
      inyectora = iny.inyectora;
    } else inyectora = null;
  }
  if (t.estado === "EN_CURSO" && inyectora !== t.inyectora) return { error: "La tanda ya está en producción: no se puede cambiar de inyectora." };
  const cantidadStock = input.cantidadStock ?? t.cantidadStock;
  if (!Number.isInteger(cantidadStock) || cantidadStock < 0) return { error: "La cantidad para stock tiene que ser un número entero (0 o más)." };
  if (t.cantidadPedidos + cantidadStock <= 0) return { error: "La tanda quedaría sin cantidad: cancelala en lugar de dejarla en cero." };
  const nuevo = {
    inyectora,
    fecha: input.fecha !== undefined ? input.fecha || null : t.fecha,
    turno: input.turno !== undefined ? input.turno : t.turno,
    cantidadStock,
    usarArranque: input.usarArranque ?? t.usarArranque,
    observaciones: input.observaciones !== undefined ? input.observaciones?.trim() || null : t.observaciones,
  };
  await db.transaction(async (tx) => {
    await tx.update(tanda).set({ ...nuevo, actualizadoEn: new Date() }).where(eq(tanda.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "tanda", entidadId: id, campo: "inyectora", anterior: t.inyectora, nuevo: nuevo.inyectora },
      { entidad: "tanda", entidadId: id, campo: "fecha", anterior: t.fecha, nuevo: nuevo.fecha },
      { entidad: "tanda", entidadId: id, campo: "turno", anterior: etiquetaTurno(t.turno), nuevo: etiquetaTurno(nuevo.turno) },
      { entidad: "tanda", entidadId: id, campo: "cantidad para stock", anterior: t.cantidadStock, nuevo: nuevo.cantidadStock },
      { entidad: "tanda", entidadId: id, campo: "receta de arranque", anterior: t.usarArranque ? "sí" : "no", nuevo: nuevo.usarArranque ? "sí" : "no" },
    ]);
  });
  return {};
}

/** Sube o baja una tanda en la secuencia (intercambia el orden con la vecina). */
export async function moverTanda(actor: Actor, id: number, direccion: "arriba" | "abajo"): Promise<Resultado> {
  if (!puedePlanificar(actor.rol)) return { error: "No tenés permiso para planificar la producción." };
  return db.transaction(async (tx) => {
    const activas = await tx.select({ id: tanda.id, orden: tanda.orden }).from(tanda).where(inArray(tanda.estado, [...ACTIVAS])).orderBy(asc(tanda.orden), asc(tanda.id)).for("update");
    const i = activas.findIndex((t) => t.id === id);
    if (i < 0) return { error: "La tanda no está en la secuencia activa." };
    const j = direccion === "arriba" ? i - 1 : i + 1;
    if (j < 0 || j >= activas.length) return {};
    const a = activas[i];
    const b = activas[j];
    const oa = a.orden === b.orden ? (direccion === "arriba" ? b.orden - 1 : b.orden + 1) : b.orden;
    await tx.update(tanda).set({ orden: oa, actualizadoEn: new Date() }).where(eq(tanda.id, a.id));
    await tx.update(tanda).set({ orden: a.orden, actualizadoEn: new Date() }).where(eq(tanda.id, b.id));
    await registrarCambios(tx, actor.id, [{ entidad: "tanda", entidadId: id, campo: "orden", anterior: i + 1, nuevo: j + 1, motivo: direccion === "arriba" ? "Adelantada en la secuencia" : "Atrasada en la secuencia" }]);
    return {};
  });
}

/** Posterga (con motivo) o reactiva una tanda. Postergar no libera sus pedidos. */
export async function postergarTanda(actor: Actor, id: number, motivo: string | null, reactivar = false): Promise<Resultado> {
  if (!puedePlanificar(actor.rol)) return { error: "No tenés permiso para planificar la producción." };
  const r = await tandaEditable(id);
  if ("error" in r) return r;
  if (r.t.estado === "EN_CURSO") return { error: "La tanda está en producción: cerrá la producción o registrá la interrupción desde la máquina." };
  if (!reactivar && !motivo?.trim()) return { error: "Indicá el motivo de la postergación (por ejemplo «se entrega la semana próxima»)." };
  const estado = reactivar ? "PLANIFICADA" : "POSTERGADA";
  await db.transaction(async (tx) => {
    await tx.update(tanda).set({ estado, postergadaMotivo: reactivar ? null : motivo!.trim(), actualizadoEn: new Date() }).where(eq(tanda.id, id));
    await registrarCambios(tx, actor.id, [{ entidad: "tanda", entidadId: id, campo: "estado", anterior: r.t.estado, nuevo: estado, motivo }]);
  });
  return {};
}

/**
 * Corta la tanda: los pedidos elegidos salen de ella y vuelven a "por
 * planificar" (para producirlos más adelante e intercalar otros colores).
 */
export async function quitarPedidosDeTanda(actor: Actor, id: number, pedidoLineaIds: number[], motivo: string | null): Promise<Resultado> {
  if (!puedePlanificar(actor.rol)) return { error: "No tenés permiso para planificar la producción." };
  const r = await tandaEditable(id);
  if ("error" in r) return r;
  if (r.t.estado === "EN_CURSO") return { error: "La tanda está en producción: no se le pueden quitar pedidos." };
  if (pedidoLineaIds.length === 0) return { error: "Elegí los pedidos que salen de la tanda." };
  return db.transaction(async (tx) => {
    const filas = await tx.select().from(tandaPedido).where(and(eq(tandaPedido.tandaId, id), inArray(tandaPedido.pedidoLineaId, pedidoLineaIds)));
    const quitado = filas.reduce((t, f) => t + f.cantidad, 0);
    const nuevaCantidad = r.t.cantidadPedidos - quitado;
    if (nuevaCantidad + r.t.cantidadStock <= 0) return { error: "La tanda quedaría vacía: cancelala o postergala." };
    await tx.delete(tandaPedido).where(and(eq(tandaPedido.tandaId, id), inArray(tandaPedido.pedidoLineaId, pedidoLineaIds)));
    await tx.update(tanda).set({ cantidadPedidos: nuevaCantidad, actualizadoEn: new Date() }).where(eq(tanda.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "tanda", entidadId: id, campo: "pedidos", anterior: filas.map((f) => `#${f.pedidoId}: ${f.cantidad}`).join(", "), nuevo: "quitados (vuelven a planificar)", motivo },
    ]);
    return {};
  });
}

export async function cancelarTanda(actor: Actor, id: number, motivo: string | null): Promise<Resultado> {
  if (!puedePlanificar(actor.rol)) return { error: "No tenés permiso para planificar la producción." };
  const r = await tandaEditable(id);
  if ("error" in r) return r;
  if (r.t.estado === "EN_CURSO") return { error: "La tanda está en producción: no se puede cancelar." };
  await db.transaction(async (tx) => {
    await tx.update(tanda).set({ estado: "CANCELADA", actualizadoEn: new Date() }).where(eq(tanda.id, id));
    await registrarCambios(tx, actor.id, [{ entidad: "tanda", entidadId: id, campo: "estado", anterior: r.t.estado, nuevo: "CANCELADA", motivo }]);
  });
  return {};
}

/** Últimos golpes registrados en una inyectora (cierre de turno o de producción). */
export async function ultimosGolpes(inyectora: string): Promise<number | null> {
  const [t] = await db
    .select({ golpes: turnoProduccion.golpesFin, fecha: turnoProduccion.fin })
    .from(turnoProduccion)
    .where(and(eq(turnoProduccion.inyectora, inyectora), sql`${turnoProduccion.golpesFin} is not null`))
    .orderBy(desc(turnoProduccion.fin))
    .limit(1);
  const [c] = await db
    .select({ golpes: cicloProduccion.golpesFin, fecha: cicloProduccion.fechaFin })
    .from(cicloProduccion)
    .where(and(sql`regexp_replace(${cicloProduccion.inyectora}, '[^0-9]', '', 'g') = ${inyectora}`, sql`${cicloProduccion.golpesFin} is not null`))
    .orderBy(desc(cicloProduccion.fechaFin))
    .limit(1);
  if (t?.fecha && (!c?.fecha || t.fecha > c.fecha)) return t.golpes;
  return c?.golpes ?? t?.golpes ?? null;
}

/**
 * Inicio de producción desde una tanda: crea la producción con los pedidos de
 * la tanda, la cantidad objetivo y la partida (continúa la abierta del mismo
 * producto si no tiene una producción en curso; si no, abre una nueva).
 */
export async function iniciarProduccionDeTanda(
  actor: Actor,
  tandaId: number,
  input: { golpesInicio: number | null; fecha?: string },
): Promise<Resultado & { cicloId?: number }> {
  // Listado de mejoras: el Encargado asigna la tanda; la inicia el operario
  // (o quien planifica). El operario sólo inicia tandas asignadas a una máquina.
  const operario = !puedePlanificar(actor.rol);
  if (operario && !puedeOperarTaller(actor.rol)) return { error: "No tenés permiso para iniciar producciones." };
  const r = await tandaEditable(tandaId);
  if ("error" in r) return r;
  const { t } = r;
  if (t.estado === "EN_CURSO") return { error: "La tanda ya está en producción.", cicloId: t.cicloId ?? undefined };
  if (t.estado === "POSTERGADA") return { error: "La tanda está postergada: la reactiva el Encargado." };
  if (!t.inyectora) return { error: operario ? "La tanda todavía no tiene máquina asignada: la asigna el Encargado." : "Asigná una inyectora a la tanda antes de iniciar la producción." };
  if (operario && t.fecha && t.fecha > hoyISO()) return { error: `La tanda está planificada para el ${t.fecha.split("-").reverse().join("/")}.` };
  if (input.golpesInicio == null) return { error: "Anotá los golpes que marca la máquina al iniciar." };
  // Máquina con material de otra producción a pie de máquina: primero se
  // devuelve o se registra (no se mezcla con la tanda nueva).
  const otros = (await obtenerRetirosMaquina({ estado: "ABIERTO", inyectora: t.inyectora })).filter(
    (rt) => rt.totales.pie > 0 && rt.productoPrevistoId != null && rt.productoPrevistoId !== t.productoId,
  );
  if (otros.length) {
    return { error: `En la inyectora ${t.inyectora} queda material de otra producción a pie de máquina (${otros.map((o) => o.numero).join(", ")}): devolvelo o conciliá el retiro antes de iniciar.` };
  }
  if (input.golpesInicio != null && (!Number.isInteger(input.golpesInicio) || input.golpesInicio < 0)) {
    return { error: "Los golpes de inicio tienen que ser un número entero." };
  }
  const [enCurso] = await db
    .select({ id: cicloProduccion.id })
    .from(cicloProduccion)
    .where(and(isNull(cicloProduccion.fechaFin), sql`regexp_replace(${cicloProduccion.inyectora}, '[^0-9]', '', 'g') = ${t.inyectora}`));
  if (enCurso) return { error: `La inyectora ${t.inyectora} tiene una producción en curso: cerrala antes de iniciar otra.` };

  const [prod] = await db.select({ piezasPorGolpe: producto.piezasPorGolpe }).from(producto).where(eq(producto.id, t.productoId));
  const abiertas = await partidasAbiertasDe(t.productoId);
  let partidaId: number | null = null;
  for (const p of abiertas) {
    const [abierto] = await db.select({ id: cicloProduccion.id }).from(cicloProduccion).where(and(eq(cicloProduccion.partidaId, p.id), isNull(cicloProduccion.fechaFin)));
    if (!abierto) {
      partidaId = p.id;
      break;
    }
  }
  const peds = await db.select().from(tandaPedido).where(eq(tandaPedido.tandaId, tandaId));
  const porPedido = new Map<number, number>();
  for (const p of peds) porPedido.set(p.pedidoId, (porPedido.get(p.pedidoId) ?? 0) + p.cantidad);
  const creado = await crearCiclo({
    fecha: input.fecha ?? hoyISO(),
    inyectora: t.inyectora,
    productoId: t.productoId,
    operarioId: null,
    golpesInicio: input.golpesInicio,
    piezasPorGolpe: prod?.piezasPorGolpe ?? null,
    cicloSegundos: null,
    modo: null,
    partidaId,
    pedidos: [...porPedido.entries()].map(([pedidoId, cantidadAsignada]) => ({ pedidoId, cantidadAsignada })),
    usuarioId: actor.id,
    cantidadDeseada: t.cantidadPedidos + t.cantidadStock,
  });
  if ("error" in creado) return creado;
  await db.transaction(async (tx) => {
    await tx.update(cicloProduccion).set({ tandaId }).where(eq(cicloProduccion.id, creado.id));
    await tx.update(tanda).set({ estado: "EN_CURSO", cicloId: creado.id, actualizadoEn: new Date() }).where(eq(tanda.id, tandaId));
    await registrarCambios(tx, actor.id, [{ entidad: "tanda", entidadId: tandaId, campo: "estado", anterior: t.estado, nuevo: "EN_CURSO", motivo: `Inicio de producción #${creado.id}` }]);
    await tx.insert(eventoProduccion).values({ cicloId: creado.id, tipo: "INICIO", motivo: `Tanda ${tandaId} · golpes ${input.golpesInicio}`, usuarioId: actor.id });
  });
  return { cicloId: creado.id };
}

/** Necesidad de compra: material que pide la planificación activa y no alcanza. */
export async function necesidadDeCompra(tandasLeidas?: TandaVista[]): Promise<(MaterialRequerido & { tandas: number[] })[]> {
  // Si la pantalla ya leyó las tandas, no se vuelven a calcular.
  const tandas = tandasLeidas ?? (await listarTandas());
  const porMp = new Map<number, MaterialRequerido & { tandas: number[] }>();
  for (const t of tandas) {
    if (t.estado === "POSTERGADA") continue;
    for (const m of t.material) {
      const a = porMp.get(m.materiaPrimaId) ?? { ...m, requeridoKg: 0, disponibleKg: 0, faltanteKg: 0, tandas: [] };
      a.requeridoKg = (aGramos(a.requeridoKg) + aGramos(m.requeridoKg)) / 1000;
      a.tandas.push(t.id);
      porMp.set(m.materiaPrimaId, a);
    }
  }
  const disp = await disponibleMp([...porMp.keys()]);
  return [...porMp.values()]
    .map((m) => {
      const d = disp.get(m.materiaPrimaId) ?? { deposito: 0, pie: 0 };
      const disponible = d.deposito + d.pie;
      return { ...m, disponibleKg: disponible, faltanteKg: Math.max(0, (aGramos(m.requeridoKg) - aGramos(disponible)) / 1000) };
    })
    .sort((a, b) => b.faltanteKg - a.faltanteKg || a.nombre.localeCompare(b.nombre));
}
