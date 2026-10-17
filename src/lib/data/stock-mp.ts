/**
 * Stock de materia prima por ubicación y sus variantes (minuta 15/10/2026):
 * lo que hoy Materia prima controla en su Excel — ingresos y egresos día por
 * día, diferencias de balanza, molienda en bolsones, fraccionamiento del
 * master, sobrantes, alta de materiales nuevos.
 *
 * Todo cambio de saldo va con su movimiento (src/lib/data/ubicaciones.ts) y
 * queda en el historial con usuario, fecha, valor y motivo.
 */
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { deposito, fraccionamientoMp, loteMp, materiaPrima, movimiento, presentacionMp, saldo, usuario } from "@/lib/db/schema";
import { ubicacionesMp } from "@/lib/data/depositos";
import { puedeAjustarMateriaPrima, puedeAltaMateriaPrima } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { ErrorStock, moverEnUbicacion } from "@/lib/data/ubicaciones";
import { obtenerParametros } from "@/lib/data/parametros";
import { semaforoStock, type EstadoSemaforo } from "@/lib/data/stock";
import { aGramos, fmtPeso } from "@/lib/presentaciones";

export type TipoMp = (typeof materiaPrima.$inferSelect)["tipo"];

export type FilaStockMp = {
  id: number;
  codigo: string;
  nombre: string;
  tipo: TipoMp;
  deposito: number;
  pie: number;
  proceso: number;
  total: number;
  minimo: number | null;
  maximo: number | null;
  /** Semáforo sobre lo disponible (depósito + pie de máquina). */
  estado: EstadoSemaforo;
};

/** Saldos de cada material en depósito, pie de máquina y tolva/en proceso. */
export async function stockMpPorUbicacion(): Promise<FilaStockMp[]> {
  const ub = await ubicacionesMp();
  const [mps, saldos, params] = await Promise.all([
    db.select().from(materiaPrima).where(eq(materiaPrima.activo, true)).orderBy(asc(materiaPrima.tipo), asc(materiaPrima.codigoInterno)),
    db
      .select({ mp: saldo.materiaPrimaId, dep: saldo.depositoId, cantidad: saldo.cantidad })
      .from(saldo)
      .where(and(sql`${saldo.materiaPrimaId} is not null`, inArray(saldo.depositoId, [ub.deposito, ub.pie, ub.proceso]))),
    obtenerParametros(),
  ]);
  return mps.map((m) => {
    const de = (d: number) => Number(saldos.find((s) => s.mp === m.id && s.dep === d)?.cantidad ?? 0);
    const dep = de(ub.deposito);
    const pie = de(ub.pie);
    const proc = de(ub.proceso);
    return {
      id: m.id,
      codigo: m.codigoInterno,
      nombre: m.nombre,
      tipo: m.tipo,
      deposito: dep,
      pie,
      proceso: proc,
      total: (aGramos(dep) + aGramos(pie) + aGramos(proc)) / 1000,
      minimo: m.minimo != null ? Number(m.minimo) : null,
      maximo: m.maximo != null ? Number(m.maximo) : null,
      estado: semaforoStock(dep + pie, m.minimo, m.maximo, params.semaforo_margen_bajo),
    };
  });
}

const ORIGEN_LABEL: Record<string, string> = {
  IMPORTACION: "Importación del Excel",
  CICLO: "Producción",
  PEDIDO: "Pedido",
  INVENTARIO: "Inventario",
  TRANSFORMACION: "Sobrante / transformación",
  INGRESO_MP: "Ingreso de proveedor",
  RETIRO_MP: "Retiro a pie de máquina",
  DEVOLUCION: "Devolución sin mezclar",
  MANUAL: "Corrección autorizada",
  CARGA_TOLVA: "Carga en tolva",
  CONSUMO: "Consumo de producción",
  DIFERENCIA_BALANZA: "Diferencia de balanza",
  MOLIENDA: "Molienda (bolsón)",
};
export const etiquetaOrigen = (o: string) => ORIGEN_LABEL[o] ?? o;

export type FilaMovimientoMp = {
  id: number;
  fecha: Date;
  ubicacion: string;
  materiaPrimaId: number;
  materiaPrima: string;
  tipoMp: TipoMp;
  /** Con signo: + entra a la ubicación, − sale. */
  kg: number;
  origen: string;
  motivo: string | null;
  usuario: string;
  lote: string | null;
};

/**
 * Movimientos día por día, como el Excel de Materia prima: fecha, ubicación,
 * material, cantidad con signo, origen, responsable y observaciones.
 */
export async function movimientosMp(filtro: { desde?: string; hasta?: string; materiaPrimaId?: number; ubicacion?: "deposito" | "pie" | "proceso"; limite?: number } = {}): Promise<FilaMovimientoMp[]> {
  const ub = await ubicacionesMp();
  const filas = await db
    .select({
      id: movimiento.id,
      fecha: movimiento.fecha,
      tipo: movimiento.tipo,
      cantidad: movimiento.cantidad,
      origen: movimiento.origen,
      motivo: movimiento.motivo,
      ubicacion: deposito.nombre,
      materiaPrimaId: materiaPrima.id,
      materiaPrima: materiaPrima.nombre,
      tipoMp: materiaPrima.tipo,
      usuario: usuario.nombre,
      lote: loteMp.numeroLote,
    })
    .from(movimiento)
    .innerJoin(materiaPrima, eq(movimiento.materiaPrimaId, materiaPrima.id))
    .innerJoin(deposito, eq(movimiento.depositoId, deposito.id))
    .innerJoin(usuario, eq(movimiento.usuarioId, usuario.id))
    .leftJoin(loteMp, eq(movimiento.loteMpId, loteMp.id))
    .where(
      and(
        filtro.desde ? gte(movimiento.fecha, new Date(`${filtro.desde}T00:00:00-03:00`)) : undefined,
        filtro.hasta ? lte(movimiento.fecha, new Date(`${filtro.hasta}T23:59:59.999-03:00`)) : undefined,
        filtro.materiaPrimaId ? eq(movimiento.materiaPrimaId, filtro.materiaPrimaId) : undefined,
        filtro.ubicacion ? eq(movimiento.depositoId, ub[filtro.ubicacion]) : undefined,
      ),
    )
    .orderBy(desc(movimiento.fecha), desc(movimiento.id))
    .limit(filtro.limite ?? 300);
  return filas.map((f) => {
    const n = Number(f.cantidad);
    const kg = f.tipo === "SALIDA" ? -Math.abs(n) : f.tipo === "ENTRADA" ? Math.abs(n) : n;
    return {
      id: f.id,
      fecha: f.fecha,
      ubicacion: f.ubicacion === "NEXA" ? "Stock general" : f.ubicacion === "Pie de máquina" ? "Stock a pie de máquina" : f.ubicacion,
      materiaPrimaId: f.materiaPrimaId,
      materiaPrima: f.materiaPrima,
      tipoMp: f.tipoMp,
      kg,
      origen: etiquetaOrigen(f.origen),
      motivo: f.motivo,
      usuario: f.usuario,
      lote: f.lote,
    };
  });
}

// ---------------------------------------------------------------------------
// Alerta de cantidades fuera de rango
// ---------------------------------------------------------------------------

/**
 * "Daniela ingresó una partida de 1.500 kg como 1,5": se avisa —sin bloquear—
 * cuando una cantidad es muy distinta de lo habitual para ese material (menos
 * de una décima parte o más de diez veces la mediana de sus ingresos), o,
 * sin historial, cuando un material virgen ingresa menos de una bolsa (25 kg).
 */
export async function alertaCantidad(materiaPrimaId: number, kg: number): Promise<string | null> {
  const [mp] = await db.select({ tipo: materiaPrima.tipo, nombre: materiaPrima.nombre }).from(materiaPrima).where(eq(materiaPrima.id, materiaPrimaId));
  if (!mp) return null;
  const previos = await db
    .select({ cantidad: loteMp.cantidadIngresada })
    .from(loteMp)
    .where(eq(loteMp.materiaPrimaId, materiaPrimaId))
    .orderBy(desc(loteMp.id))
    .limit(20);
  const valores = previos.map((p) => Number(p.cantidad)).sort((a, b) => a - b);
  if (valores.length >= 2) {
    const mediana = valores[Math.floor(valores.length / 2)];
    if (kg < mediana / 10 || kg > mediana * 10) {
      return `Los ingresos de ${mp.nombre} suelen ser de unos ${fmtPeso(mediana)}. ¿Seguro que son ${fmtPeso(kg)}? (1.500 kg se escribe «1.500» o «1500», no «1,5»).`;
    }
    return null;
  }
  if (mp.tipo === "VIRGEN" && kg < 25) return `${fmtPeso(kg)} es menos de una bolsa de 25 kg. ¿Seguro? (1.500 kg se escribe «1.500» o «1500», no «1,5»).`;
  return null;
}

// ---------------------------------------------------------------------------
// Ajustes autorizados
// ---------------------------------------------------------------------------

export const MOTIVOS_AJUSTE_MP = [
  "Diferencia de balanza al terminar una bolsa",
  "Recuento físico",
  "Material dañado o mojado",
  "Faltante justificado",
  "Sobreconsumo justificado",
  "Otro",
] as const;

/** Diferencia de balanza o ajuste autorizado en el depósito o a pie de máquina. */
export async function ajustarStockMp(
  actor: Actor,
  input: { materiaPrimaId: number; ubicacion: "deposito" | "pie"; deltaKg: number; motivo: string; detalle?: string | null },
): Promise<Resultado> {
  if (!puedeAjustarMateriaPrima(actor.rol)) return { error: "No tenés permiso para ajustar el stock de materia prima." };
  if (!Number.isFinite(input.deltaKg) || input.deltaKg === 0) return { error: "Indicá cuántos kg sobran (+) o faltan (−)." };
  if (!input.motivo?.trim()) return { error: "Elegí el motivo del ajuste." };
  const ub = await ubicacionesMp();
  const [mp] = await db.select({ nombre: materiaPrima.nombre }).from(materiaPrima).where(eq(materiaPrima.id, input.materiaPrimaId));
  if (!mp) return { error: "Material no encontrado." };
  const motivo = [input.motivo.trim(), input.detalle?.trim()].filter(Boolean).join(" — ");
  return db
    .transaction(async (tx) => {
      const id = await moverEnUbicacion(tx, {
        depositoId: ub[input.ubicacion],
        tipo: "AJUSTE",
        mpId: input.materiaPrimaId,
        delta: input.deltaKg,
        origen: input.motivo.startsWith("Diferencia de balanza") ? "DIFERENCIA_BALANZA" : "MANUAL",
        motivo,
        usuarioId: actor.id,
        nombreMp: mp.nombre,
        nombreUbicacion: input.ubicacion === "pie" ? "A pie de máquina" : "En el depósito",
      });
      await registrarCambios(tx, actor.id, [
        { entidad: "materia_prima", entidadId: input.materiaPrimaId, campo: `ajuste ${input.ubicacion === "pie" ? "pie de máquina" : "depósito"}`, anterior: null, nuevo: `${input.deltaKg > 0 ? "+" : ""}${input.deltaKg} kg (mov. ${id})`, motivo },
      ]);
      return {};
    })
    .catch((e) => {
      if (e instanceof ErrorStock) return { error: e.message };
      throw e;
    });
}

// ---------------------------------------------------------------------------
// Molienda en bolsones
// ---------------------------------------------------------------------------

/**
 * El scrap molido "entra como material sin peso de origen": se pesa y se
 * vuelca en bolsones de peso variable. Cada bolsón queda como un lote con
 * código propio (27 dígitos, proveedor/certificado 99999999 = interno) para
 * poder retirarlo y descontarlo al usarlo.
 */
export async function ingresarBolsonMolienda(actor: Actor, input: { materiaPrimaId: number; kg: number; observaciones?: string | null }): Promise<Resultado & { codigo?: string }> {
  if (!puedeAjustarMateriaPrima(actor.rol)) return { error: "No tenés permiso para registrar molienda." };
  if (!Number.isFinite(input.kg) || input.kg <= 0 || input.kg > 3000) return { error: "El peso del bolsón tiene que estar entre 0 y 3.000 kg." };
  const [mp] = await db.select().from(materiaPrima).where(eq(materiaPrima.id, input.materiaPrimaId));
  if (!mp || (mp.tipo !== "MOLIENDA" && mp.tipo !== "SOBRANTE")) return { error: "Elegí un código de molienda o sobrante." };
  const ub = await ubicacionesMp();
  const codMp = (mp.codigoInterno.replace(/\D/g, "") || String(mp.id)).padStart(4, "0").slice(-4);
  return db.transaction(async (tx) => {
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(loteMp)
      .where(sql`${loteMp.codigoBarra} like ${`000${codMp}99999999%`}`);
    const numero = String(n + 1).padStart(12, "0");
    const codigo = `000${codMp}99999999${numero}`;
    const [lote] = await tx
      .insert(loteMp)
      .values({ materiaPrimaId: mp.id, numeroLote: numero, codigoBarra: codigo, fechaIngreso: new Date().toISOString().slice(0, 10), cantidadIngresada: String(input.kg), ubicacion: input.observaciones?.trim() || null })
      .returning();
    await moverEnUbicacion(tx, {
      depositoId: ub.deposito,
      tipo: "ENTRADA",
      mpId: mp.id,
      loteMpId: lote.id,
      delta: input.kg,
      origen: "MOLIENDA",
      origenId: lote.id,
      motivo: `Bolsón de ${mp.nombre} N° ${n + 1}${input.observaciones?.trim() ? ` · ${input.observaciones.trim()}` : ""}`,
      usuarioId: actor.id,
    });
    return { codigo };
  });
}

// ---------------------------------------------------------------------------
// Fraccionamiento del master
// ---------------------------------------------------------------------------

/**
 * De la bolsa grande se arman bolsitas (600 g, 750 g). El material y sus kilos
 * no cambian (se reenvasa): queda el registro de qué envase salieron y cuántas
 * bolsitas se armaron. Las bolsitas sin usar vuelven con la devolución del
 * retiro, sin duplicar la cantidad original.
 */
export async function fraccionarMaster(
  actor: Actor,
  input: { materiaPrimaId: number; presentacionId: number; cantidad: number; loteMpId?: number | null; observaciones?: string | null },
): Promise<Resultado> {
  if (!puedeAjustarMateriaPrima(actor.rol)) return { error: "No tenés permiso para fraccionar master." };
  if (!Number.isInteger(input.cantidad) || input.cantidad <= 0) return { error: "Indicá cuántas bolsitas se armaron." };
  const [mp] = await db.select().from(materiaPrima).where(eq(materiaPrima.id, input.materiaPrimaId));
  const [p] = await db.select().from(presentacionMp).where(eq(presentacionMp.id, input.presentacionId));
  if (!mp || mp.tipo !== "MASTER") return { error: "Elegí un master." };
  if (!p || !(p.materiaPrimaId === mp.id || (p.materiaPrimaId == null && p.tipoMp === "MASTER"))) return { error: "La presentación no corresponde a ese master." };
  const kg = (aGramos(Number(p.kg)) * input.cantidad) / 1000;
  const ub = await ubicacionesMp();
  const [s] = await db.select({ cantidad: saldo.cantidad }).from(saldo).where(and(eq(saldo.depositoId, ub.deposito), eq(saldo.materiaPrimaId, mp.id)));
  const hay = Number(s?.cantidad ?? 0);
  if (kg > hay + 1e-6) return { error: `En el depósito hay ${fmtPeso(hay, { gramos: true })} de ${mp.nombre}: no alcanza para ${input.cantidad} × ${p.nombre}.` };
  await db.transaction(async (tx) => {
    const [f] = await tx
      .insert(fraccionamientoMp)
      .values({ materiaPrimaId: mp.id, loteMpId: input.loteMpId ?? null, presentacionId: p.id, cantidad: input.cantidad, kgTotal: String(kg), observaciones: input.observaciones?.trim() || null, usuarioId: actor.id })
      .returning();
    await registrarCambios(tx, actor.id, [{ entidad: "materia_prima", entidadId: mp.id, campo: "fraccionamiento", anterior: null, nuevo: `${input.cantidad} × ${p.nombre} (${fmtPeso(kg, { gramos: true })}) · registro ${f.id}` }]);
  });
  return {};
}

export async function fraccionamientosRecientes(limite = 20) {
  return db
    .select({ f: fraccionamientoMp, mp: materiaPrima.nombre, presentacion: presentacionMp.nombre, usuario: usuario.nombre })
    .from(fraccionamientoMp)
    .innerJoin(materiaPrima, eq(fraccionamientoMp.materiaPrimaId, materiaPrima.id))
    .innerJoin(presentacionMp, eq(fraccionamientoMp.presentacionId, presentacionMp.id))
    .innerJoin(usuario, eq(fraccionamientoMp.usuarioId, usuario.id))
    .orderBy(desc(fraccionamientoMp.fecha))
    .limit(limite);
}

// ---------------------------------------------------------------------------
// Alta de materiales (cambio estructural: Supervisión y Gerencia)
// ---------------------------------------------------------------------------

export async function altaMateriaPrima(
  actor: Actor,
  input: { codigoInterno: string; nombre: string; tipo: TipoMp; proveedor?: string | null; motivo?: string | null },
): Promise<Resultado & { id?: number }> {
  if (!puedeAltaMateriaPrima(actor.rol)) return { error: "El alta de materiales la hacen Supervisión o Gerencia. Informales el material nuevo." };
  const codigo = input.codigoInterno.trim();
  const nombre = input.nombre.trim();
  if (!codigo || !nombre) return { error: "Faltan el código y el nombre." };
  if (!["VIRGEN", "MASTER", "MOLIENDA", "SOBRANTE", "MUESTRA"].includes(input.tipo)) return { error: "Tipo inválido." };
  const [ya] = await db.select({ id: materiaPrima.id }).from(materiaPrima).where(sql`lower(${materiaPrima.codigoInterno}) = lower(${codigo})`);
  if (ya) return { error: `Ya existe un material con el código ${codigo}.` };
  return db.transaction(async (tx) => {
    const [m] = await tx.insert(materiaPrima).values({ codigoInterno: codigo, nombre, tipo: input.tipo, proveedor: input.proveedor?.trim() || null }).returning();
    await registrarCambios(tx, actor.id, [{ entidad: "materia_prima", entidadId: m.id, campo: "alta", anterior: null, nuevo: `${codigo} · ${nombre} (${input.tipo})`, motivo: input.motivo }]);
    return { id: m.id };
  });
}
