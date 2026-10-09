/**
 * Circuito de materia prima en la máquina (turnos rotativos de 24 h).
 *
 *   depósito ──retiro──▶ pie de máquina ──carga──▶ tolva ──▶ producción
 *                           │                        │
 *                           └─devolución (sin mezclar)┘─sobrante (mezclado con master)
 *
 * - El depósito es el ledger de siempre (movimiento + saldo): el retiro le
 *   descuenta; la devolución y el sobrante le suman. Nada más lo toca.
 * - El saldo a pie de máquina de cada línea de retiro se calcula de sus
 *   registros: retirado − cargado − devuelto − diferencia justificada. Las
 *   operaciones bloquean la línea (FOR UPDATE) y aceptan una clave (`token`)
 *   para que un doble envío no cargue ni devuelva dos veces.
 * - Un retiro queda ABIERTO entre turnos y jornadas; se cierra sólo cuando el
 *   saldo a pie de máquina de todas sus líneas es cero, justificando lo que no
 *   cierra. No se ajustan cantidades solas ni se borra historial.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  certificadoCalidad,
  cicloMateriaPrima,
  cicloProduccion,
  loteMp,
  materiaPrima,
  movimiento,
  movimientoMaquina,
  partida,
  producto,
  retiroMaquina,
  retiroMp,
  saldo,
  usuario,
} from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { puedeRetirarMateriaPrima } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { INYECTORAS } from "@/lib/inyectoras";
import { hoyISO } from "@/lib/format";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Ejecutor = Tx | typeof db;

const EPS = 1e-6;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function numeroRetiro(id: number): string {
  return `RM-${String(id).padStart(5, "0")}`;
}

// ---------------------------------------------------------------------------
// Código de barras de materia prima
// ---------------------------------------------------------------------------

export type CodigoIdentificado = {
  codigo: string;
  bloques: { producto: string; materiaPrima: string; proveedorCertificado: string; lote: string };
  lote: { id: number; codigoBarra: string; numeroLote: string; materiaPrimaId: number; materiaPrimaNombre: string } | null;
  certificado: { numero: number; proveedor: string } | null;
  disponibleKg: number | null;
  advertencias: string[];
};

/**
 * Identifica un código de 27 dígitos. Los 3 primeros son 000 en el depósito y
 * el número de producto una vez asignado a producción: se busca el lote por el
 * código de ingreso (000 + resto). Sólo devuelve datos que existen en el código
 * o en un registro; lo demás queda para cargar a mano.
 */
export async function identificarCodigoMp(codigo: string, productoNumero?: string | null): Promise<Resultado & { dato?: CodigoIdentificado }> {
  const c = codigo.replace(/\s+/g, "");
  if (!/^\d{27}$/.test(c)) return { error: "El código de materia prima tiene 27 dígitos (3 + 4 + 8 + 12)." };
  const bloques = { producto: c.slice(0, 3), materiaPrima: c.slice(3, 7), proveedorCertificado: c.slice(7, 15), lote: c.slice(15) };
  const advertencias: string[] = [];
  if (bloques.producto !== "000") {
    const esperado = productoNumero ? productoNumero.padStart(3, "0").slice(-3) : null;
    if (esperado && bloques.producto !== esperado) {
      return { error: `El código está asignado al producto ${bloques.producto}, no al ${esperado} de este ciclo.` };
    }
    advertencias.push(`Código ya asignado al producto ${bloques.producto}.`);
  }
  const codigoIngreso = `000${c.slice(3)}`;
  const [l] = await db
    .select({
      id: loteMp.id,
      codigoBarra: loteMp.codigoBarra,
      numeroLote: loteMp.numeroLote,
      materiaPrimaId: loteMp.materiaPrimaId,
      materiaPrimaNombre: materiaPrima.nombre,
      certNumero: certificadoCalidad.numeroCorrelativo,
      certProveedor: certificadoCalidad.proveedor,
    })
    .from(loteMp)
    .innerJoin(materiaPrima, eq(loteMp.materiaPrimaId, materiaPrima.id))
    .leftJoin(certificadoCalidad, eq(loteMp.certificadoId, certificadoCalidad.id))
    .where(eq(loteMp.codigoBarra, codigoIngreso));
  if (!l) {
    advertencias.push("El código no corresponde a ningún lote ingresado: completá materia prima y lote a mano.");
    return { dato: { codigo: c, bloques, lote: null, certificado: null, disponibleKg: null, advertencias } };
  }
  const disponible = (await disponibleDeLotes(db, [l.id])).get(l.id) ?? 0;
  if (l.certNumero == null) advertencias.push("El lote no tiene certificado de calidad registrado.");
  return {
    dato: {
      codigo: c,
      bloques,
      lote: { id: l.id, codigoBarra: l.codigoBarra, numeroLote: l.numeroLote, materiaPrimaId: l.materiaPrimaId, materiaPrimaNombre: l.materiaPrimaNombre },
      certificado: l.certNumero != null ? { numero: l.certNumero, proveedor: l.certProveedor ?? "" } : null,
      disponibleKg: disponible,
      advertencias,
    },
  };
}

/** Disponible de cada lote en el depósito: ingresado − retirado (no anulado) + devuelto. */
export async function disponibleDeLotes(ex: Ejecutor, loteIds: number[]): Promise<Map<number, number>> {
  if (loteIds.length === 0) return new Map();
  const lotes = await ex.select({ id: loteMp.id, ingresado: loteMp.cantidadIngresada }).from(loteMp).where(inArray(loteMp.id, loteIds));
  const retirado = await ex
    .select({ loteId: retiroMp.loteMpId, total: sql<number>`coalesce(sum(${retiroMp.cantidad}), 0)`.mapWith(Number) })
    .from(retiroMp)
    .where(and(inArray(retiroMp.loteMpId, loteIds), eq(retiroMp.anulado, false)))
    .groupBy(retiroMp.loteMpId);
  const devuelto = await ex
    .select({ loteId: retiroMp.loteMpId, total: sql<number>`coalesce(sum(${movimientoMaquina.cantidad}), 0)`.mapWith(Number) })
    .from(movimientoMaquina)
    .innerJoin(retiroMp, eq(movimientoMaquina.retiroMpId, retiroMp.id))
    .where(and(inArray(retiroMp.loteMpId, loteIds), eq(movimientoMaquina.tipo, "DEVOLUCION"), eq(movimientoMaquina.anulado, false)))
    .groupBy(retiroMp.loteMpId);
  const ret = new Map(retirado.map((r) => [r.loteId!, r.total]));
  const dev = new Map(devuelto.map((r) => [r.loteId!, r.total]));
  return new Map(lotes.map((l) => [l.id, r3(Number(l.ingresado) - (ret.get(l.id) ?? 0) + (dev.get(l.id) ?? 0))]));
}

// ---------------------------------------------------------------------------
// Saldos de pie de máquina
// ---------------------------------------------------------------------------

export type SaldoLinea = {
  retiroMpId: number;
  retirado: number;
  cargado: number;
  devuelto: number;
  diferencia: number;
  /** Lo que sigue junto a la máquina, sin cargar. */
  pie: number;
};

export async function saldosDeLineas(ex: Ejecutor, retiroMpIds: number[]): Promise<Map<number, SaldoLinea>> {
  if (retiroMpIds.length === 0) return new Map();
  const lineas = await ex.select({ id: retiroMp.id, cantidad: retiroMp.cantidad, anulado: retiroMp.anulado }).from(retiroMp).where(inArray(retiroMp.id, retiroMpIds));
  const movs = await ex
    .select({ lineaId: movimientoMaquina.retiroMpId, tipo: movimientoMaquina.tipo, total: sql<number>`coalesce(sum(${movimientoMaquina.cantidad}), 0)`.mapWith(Number) })
    .from(movimientoMaquina)
    .where(and(inArray(movimientoMaquina.retiroMpId, retiroMpIds), eq(movimientoMaquina.anulado, false)))
    .groupBy(movimientoMaquina.retiroMpId, movimientoMaquina.tipo);
  const res = new Map<number, SaldoLinea>();
  for (const l of lineas) {
    const de = (t: string) => movs.find((m) => m.lineaId === l.id && m.tipo === t)?.total ?? 0;
    const retirado = l.anulado ? 0 : Number(l.cantidad);
    const s = { retiroMpId: l.id, retirado, cargado: de("CARGA_TOLVA"), devuelto: de("DEVOLUCION"), diferencia: de("DIFERENCIA"), pie: 0 };
    s.pie = r3(s.retirado - s.cargado - s.devuelto - s.diferencia);
    res.set(l.id, s);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Movimiento A: retiro del depósito a pie de máquina
// ---------------------------------------------------------------------------

export type LineaRetiroInput = { materiaPrimaId: number; loteMpId: number | null; cantidadKg: number; codigoLeido?: string | null };

export type RetiroMaquinaInput = {
  cicloId: number | null;
  /** Sin ciclo: obligatoria y de la lista de la planta. Con ciclo: la del ciclo. */
  inyectora?: string | null;
  operarioId?: number | null;
  entregaId?: number | null;
  piezasPrevistas?: number | null;
  observaciones?: string | null;
  lineas: LineaRetiroInput[];
  token?: string | null;
  fecha?: string;
};

export async function registrarRetiroMaquina(
  actor: Actor,
  input: RetiroMaquinaInput,
): Promise<Resultado & { id?: number; lineaIds?: number[]; repetido?: boolean }> {
  if (!puedeRetirarMateriaPrima(actor.rol)) return { error: "No tenés permiso para retirar materia prima." };
  const lineas = input.lineas.filter((l) => l.materiaPrimaId);
  if (lineas.length === 0) return { error: "Agregá al menos un material." };
  if (lineas.some((l) => !Number.isFinite(l.cantidadKg) || l.cantidadKg <= 0)) return { error: "Cada material necesita una cantidad mayor que cero." };
  if (input.piezasPrevistas != null && (!Number.isInteger(input.piezasPrevistas) || input.piezasPrevistas <= 0)) {
    return { error: "Las piezas previstas tienen que ser un número entero mayor que cero." };
  }
  const depositoId = await getDepositoNexaId();

  return db.transaction(async (tx) => {
    if (input.token) {
      const [ya] = await tx.select({ id: retiroMaquina.id }).from(retiroMaquina).where(eq(retiroMaquina.token, input.token));
      if (ya) {
        const ls = await tx.select({ id: retiroMp.id }).from(retiroMp).where(eq(retiroMp.retiroMaquinaId, ya.id));
        return { id: ya.id, lineaIds: ls.map((x) => x.id), repetido: true };
      }
    }

    let inyectora: string;
    let productoPrevistoId: number | null = null;
    let productoNumero: string | null = null;
    if (input.cicloId != null) {
      const [c] = await tx
        .select({ id: cicloProduccion.id, inyectora: cicloProduccion.inyectora, fechaFin: cicloProduccion.fechaFin, productoId: cicloProduccion.productoId, numero: producto.numero })
        .from(cicloProduccion)
        .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
        .where(eq(cicloProduccion.id, input.cicloId));
      if (!c) return { error: "El ciclo indicado no existe." };
      if (c.fechaFin) return { error: `El ciclo #${c.id} ya está cerrado: iniciá el ciclo de la jornada para retirar material.` };
      inyectora = c.inyectora.replace(/inyectora/i, "").trim();
      productoPrevistoId = c.productoId;
      productoNumero = c.numero;
    } else {
      const v = String(input.inyectora ?? "").replace(/inyectora/i, "").trim();
      if (!v) return { error: "Indicá la inyectora a la que va el material." };
      if (!(INYECTORAS as readonly string[]).includes(v)) return { error: `La inyectora ${v} no existe en la planta (1 a 8).` };
      inyectora = v;
    }

    const [cab] = await tx
      .insert(retiroMaquina)
      .values({
        inyectora,
        cicloId: input.cicloId,
        operarioId: input.operarioId ?? null,
        entregaId: input.entregaId ?? null,
        productoPrevistoId,
        piezasPrevistas: input.piezasPrevistas ?? null,
        observaciones: input.observaciones?.trim() || null,
        token: input.token || null,
        creadoPorId: actor.id,
      })
      .returning();

    const lineaIds: number[] = [];
    for (const l of lineas) {
      const [mp] = await tx.select().from(materiaPrima).where(eq(materiaPrima.id, l.materiaPrimaId));
      if (!mp) throw new ErrorRetiro("Materia prima no encontrada.");
      // Serializa los retiros de la misma MP (dos retiros simultáneos no superan el stock).
      const [s] = await tx
        .select({ cantidad: saldo.cantidad })
        .from(saldo)
        .where(and(eq(saldo.depositoId, depositoId), eq(saldo.materiaPrimaId, mp.id)))
        .for("update");
      if (l.loteMpId != null) {
        const [lote] = await tx.select().from(loteMp).where(eq(loteMp.id, l.loteMpId));
        if (!lote || lote.materiaPrimaId !== mp.id) throw new ErrorRetiro(`El lote no corresponde a ${mp.nombre}.`);
        const disponible = (await disponibleDeLotes(tx, [lote.id])).get(lote.id) ?? 0;
        if (l.cantidadKg > disponible + EPS) throw new ErrorRetiro(`El lote ${lote.numeroLote} tiene ${disponible} kg disponibles.`);
        if (l.codigoLeido) {
          const c = l.codigoLeido.replace(/\s+/g, "");
          if (`000${c.slice(3)}` !== lote.codigoBarra) throw new ErrorRetiro(`El código leído no corresponde al lote ${lote.numeroLote}.`);
          if (c.slice(0, 3) !== "000" && productoNumero && c.slice(0, 3) !== productoNumero.padStart(3, "0").slice(-3)) {
            throw new ErrorRetiro("El código leído está asignado a otro producto.");
          }
        }
      } else if (l.codigoLeido) {
        throw new ErrorRetiro("Se leyó un código pero no se eligió el lote correspondiente.");
      }
      if (l.cantidadKg > Number(s?.cantidad ?? 0) + EPS) throw new ErrorRetiro(`Hay ${Number(s?.cantidad ?? 0)} kg en stock de ${mp.nombre}.`);

      const [linea] = await tx
        .insert(retiroMp)
        .values({
          fecha: input.fecha ?? hoyISO(),
          materiaPrimaId: mp.id,
          loteMpId: l.loteMpId,
          cicloId: input.cicloId,
          cantidad: String(l.cantidadKg),
          inyectora,
          retiraId: input.operarioId ?? actor.id,
          entregaId: input.entregaId ?? null,
          observaciones: input.observaciones?.trim() || null,
          retiroMaquinaId: cab.id,
          codigoLeido: l.codigoLeido?.replace(/\s+/g, "") || null,
        })
        .returning();
      await tx.insert(movimiento).values({
        tipo: "SALIDA",
        depositoId,
        materiaPrimaId: mp.id,
        loteMpId: l.loteMpId,
        cantidad: String(l.cantidadKg),
        origen: "RETIRO_MP",
        origenId: linea.id,
        motivo: `Retiro ${numeroRetiro(cab.id)} a pie de máquina · inyectora ${inyectora}${input.cicloId ? ` · ciclo #${input.cicloId}` : ""}`,
        usuarioId: actor.id,
      });
      await tx
        .update(saldo)
        .set({ cantidad: sql`${saldo.cantidad} - ${l.cantidadKg}` })
        .where(and(eq(saldo.depositoId, depositoId), eq(saldo.materiaPrimaId, mp.id)));
      lineaIds.push(linea.id);
    }
    return { id: cab.id, lineaIds };
  }).catch((e) => {
    if (e instanceof ErrorRetiro) return { error: e.message };
    throw e;
  });
}

/** Error de validación dentro de la transacción: la revierte entera. */
class ErrorRetiro extends Error {}

// ---------------------------------------------------------------------------
// Movimiento B: carga en tolva · devolución · sobrante
// ---------------------------------------------------------------------------

async function lineaBloqueada(tx: Tx, retiroMpId: number) {
  const [l] = await tx.select().from(retiroMp).where(eq(retiroMp.id, retiroMpId)).for("update");
  if (!l) return null;
  if (!l.retiroMaquinaId) return null;
  const [cab] = await tx.select().from(retiroMaquina).where(eq(retiroMaquina.id, l.retiroMaquinaId)).for("update");
  return { linea: l, cab };
}

async function porToken(tx: Tx, token: string | null | undefined) {
  if (!token) return null;
  const [m] = await tx.select({ id: movimientoMaquina.id }).from(movimientoMaquina).where(eq(movimientoMaquina.token, token));
  return m ?? null;
}

export async function cargarEnTolva(
  actor: Actor,
  input: { retiroMpId: number; cantidadKg: number; cicloId: number; observaciones?: string | null; token?: string | null },
): Promise<Resultado & { id?: number; repetido?: boolean }> {
  if (!puedeRetirarMateriaPrima(actor.rol)) return { error: "No tenés permiso para operar la carga de máquina." };
  if (!Number.isFinite(input.cantidadKg) || input.cantidadKg <= 0) return { error: "La cantidad cargada tiene que ser mayor que cero." };
  return db.transaction(async (tx) => {
    const ya = await porToken(tx, input.token);
    if (ya) return { id: ya.id, repetido: true };
    const b = await lineaBloqueada(tx, input.retiroMpId);
    if (!b) return { error: "Línea de retiro no encontrada en el circuito de pie de máquina." };
    const { linea, cab } = b;
    if (cab.estado !== "ABIERTO") return { error: `El retiro ${numeroRetiro(cab.id)} está cerrado.` };
    if (linea.anulado) return { error: "La línea de retiro está anulada." };

    const [c] = await tx.select().from(cicloProduccion).where(eq(cicloProduccion.id, input.cicloId));
    if (!c) return { error: "Ciclo no encontrado." };
    if (c.fechaFin) return { error: `El ciclo #${c.id} está cerrado: la carga va al ciclo en curso.` };
    if (c.inyectora.replace(/inyectora/i, "").trim() !== cab.inyectora) {
      return { error: `El material está en la inyectora ${cab.inyectora} y el ciclo #${c.id} es de la ${c.inyectora}.` };
    }
    if (cab.cicloId != null && cab.cicloId !== c.id) {
      // Entre jornadas sigue la misma partida; con otro producto hay que devolver o registrar sobrante.
      const [origen] = await tx.select({ partidaId: cicloProduccion.partidaId }).from(cicloProduccion).where(eq(cicloProduccion.id, cab.cicloId));
      if (origen?.partidaId !== c.partidaId) {
        return { error: "El material se retiró para otra producción (otra partida): devolvelo al depósito o registralo como sobrante." };
      }
    }
    const saldoLinea = (await saldosDeLineas(tx, [linea.id])).get(linea.id)!;
    if (input.cantidadKg > saldoLinea.pie + EPS) return { error: `A pie de máquina quedan ${saldoLinea.pie} kg de esta línea.` };

    const [mp] = await tx.select({ tipo: materiaPrima.tipo }).from(materiaPrima).where(eq(materiaPrima.id, linea.materiaPrimaId));
    const [m] = await tx
      .insert(movimientoMaquina)
      .values({
        retiroMaquinaId: cab.id,
        retiroMpId: linea.id,
        tipo: "CARGA_TOLVA",
        cantidad: String(input.cantidadKg),
        cicloId: c.id,
        observaciones: input.observaciones?.trim() || null,
        usuarioId: actor.id,
        token: input.token || null,
      })
      .returning();
    // Eslabón de trazabilidad lote → ciclo → partida: lo que efectivamente entró a la máquina.
    await tx.insert(cicloMateriaPrima).values({
      cicloId: c.id,
      loteMpId: linea.loteMpId,
      materiaPrimaId: linea.materiaPrimaId,
      cantidadKg: String(input.cantidadKg),
      esMaster: mp.tipo === "MASTER",
      movimientoMaquinaId: m.id,
    });
    return { id: m.id };
  });
}

/** Material sin mezclar que vuelve al depósito (cambio de producto, parada). */
export async function devolverADeposito(
  actor: Actor,
  input: { retiroMpId: number; cantidadKg: number; observaciones?: string | null; token?: string | null },
): Promise<Resultado & { id?: number; repetido?: boolean }> {
  if (!puedeRetirarMateriaPrima(actor.rol)) return { error: "No tenés permiso para devolver materia prima." };
  if (!Number.isFinite(input.cantidadKg) || input.cantidadKg <= 0) return { error: "La cantidad devuelta tiene que ser mayor que cero." };
  const depositoId = await getDepositoNexaId();
  return db.transaction(async (tx) => {
    const ya = await porToken(tx, input.token);
    if (ya) return { id: ya.id, repetido: true };
    const b = await lineaBloqueada(tx, input.retiroMpId);
    if (!b) return { error: "Línea de retiro no encontrada en el circuito de pie de máquina." };
    const { linea, cab } = b;
    if (cab.estado !== "ABIERTO") return { error: `El retiro ${numeroRetiro(cab.id)} está cerrado.` };
    if (linea.anulado) return { error: "La línea de retiro está anulada." };
    const saldoLinea = (await saldosDeLineas(tx, [linea.id])).get(linea.id)!;
    if (input.cantidadKg > saldoLinea.pie + EPS) {
      return { error: `A pie de máquina quedan ${saldoLinea.pie} kg sin cargar de esta línea; lo cargado en tolva sólo vuelve como sobrante.` };
    }
    const [mp] = await tx.select({ nombre: materiaPrima.nombre }).from(materiaPrima).where(eq(materiaPrima.id, linea.materiaPrimaId));
    const [mov] = await tx
      .insert(movimiento)
      .values({
        tipo: "ENTRADA",
        depositoId,
        materiaPrimaId: linea.materiaPrimaId,
        loteMpId: linea.loteMpId,
        cantidad: String(input.cantidadKg),
        origen: "DEVOLUCION",
        origenId: linea.id,
        motivo: `Devolución sin mezclar del retiro ${numeroRetiro(cab.id)} · ${mp.nombre}`,
        usuarioId: actor.id,
      })
      .returning();
    await tx
      .insert(saldo)
      .values({ depositoId, materiaPrimaId: linea.materiaPrimaId, cantidad: String(input.cantidadKg) })
      .onConflictDoUpdate({ target: [saldo.depositoId, saldo.materiaPrimaId], set: { cantidad: sql`${saldo.cantidad} + ${input.cantidadKg}` } });
    const [m] = await tx
      .insert(movimientoMaquina)
      .values({
        retiroMaquinaId: cab.id,
        retiroMpId: linea.id,
        tipo: "DEVOLUCION",
        cantidad: String(input.cantidadKg),
        cicloId: cab.cicloId,
        movimientoId: mov.id,
        observaciones: input.observaciones?.trim() || null,
        usuarioId: actor.id,
        token: input.token || null,
      })
      .returning();
    return { id: m.id };
  });
}

/** Códigos de depósito válidos para material mezclado que sale de la tolva. */
export async function codigosDeSobrante() {
  return db
    .select({ id: materiaPrima.id, codigo: materiaPrima.codigoInterno, nombre: materiaPrima.nombre, tipo: materiaPrima.tipo })
    .from(materiaPrima)
    .where(and(inArray(materiaPrima.tipo, ["SOBRANTE", "MOLIENDA"]), eq(materiaPrima.activo, true)))
    .orderBy(asc(materiaPrima.codigoInterno));
}

/**
 * Material ya mezclado con master que se retira de la tolva: entra al depósito
 * con el código de sobrante/molienda elegido (no vuelve como virgen). Queda la
 * composición (materiales cargados del retiro) en el registro.
 */
export async function registrarSobrante(
  actor: Actor,
  input: { retiroMaquinaId: number; materiaPrimaDestinoId: number; cantidadKg: number; observaciones?: string | null; token?: string | null },
): Promise<Resultado & { id?: number; repetido?: boolean }> {
  if (!puedeRetirarMateriaPrima(actor.rol)) return { error: "No tenés permiso para registrar sobrantes." };
  if (!Number.isFinite(input.cantidadKg) || input.cantidadKg <= 0) return { error: "La cantidad tiene que ser mayor que cero." };
  const depositoId = await getDepositoNexaId();
  return db.transaction(async (tx) => {
    const ya = await porToken(tx, input.token);
    if (ya) return { id: ya.id, repetido: true };
    const [cab] = await tx.select().from(retiroMaquina).where(eq(retiroMaquina.id, input.retiroMaquinaId)).for("update");
    if (!cab) return { error: "Retiro no encontrado." };
    if (cab.estado !== "ABIERTO") return { error: `El retiro ${numeroRetiro(cab.id)} está cerrado.` };
    const [destino] = await tx.select().from(materiaPrima).where(eq(materiaPrima.id, input.materiaPrimaDestinoId));
    if (!destino || (destino.tipo !== "SOBRANTE" && destino.tipo !== "MOLIENDA")) {
      return { error: "Elegí un código de sobrante o molienda existente en el depósito." };
    }
    const movs = await tx
      .select({ tipo: movimientoMaquina.tipo, cantidad: movimientoMaquina.cantidad, mp: materiaPrima.nombre })
      .from(movimientoMaquina)
      .leftJoin(retiroMp, eq(movimientoMaquina.retiroMpId, retiroMp.id))
      .leftJoin(materiaPrima, eq(retiroMp.materiaPrimaId, materiaPrima.id))
      .where(and(eq(movimientoMaquina.retiroMaquinaId, cab.id), eq(movimientoMaquina.anulado, false)));
    const cargado = movs.filter((m) => m.tipo === "CARGA_TOLVA").reduce((t, m) => t + Number(m.cantidad), 0);
    const sobrantes = movs.filter((m) => m.tipo === "SOBRANTE").reduce((t, m) => t + Number(m.cantidad), 0);
    if (cargado <= EPS) return { error: "Este retiro no tiene material cargado en tolva: lo que está a pie de máquina se devuelve sin mezclar." };
    if (input.cantidadKg > cargado - sobrantes + EPS) {
      return { error: `Del retiro se cargaron ${r3(cargado)} kg y ya se registraron ${r3(sobrantes)} kg de sobrante.` };
    }
    const composicion = [...new Set(movs.filter((m) => m.tipo === "CARGA_TOLVA" && m.mp).map((m) => m.mp))].join(" + ");
    const [mov] = await tx
      .insert(movimiento)
      .values({
        tipo: "ENTRADA",
        depositoId,
        materiaPrimaId: destino.id,
        cantidad: String(input.cantidadKg),
        origen: "TRANSFORMACION",
        origenId: cab.id,
        motivo: `Sobrante de tolva del retiro ${numeroRetiro(cab.id)} · composición: ${composicion}`,
        usuarioId: actor.id,
      })
      .returning();
    await tx
      .insert(saldo)
      .values({ depositoId, materiaPrimaId: destino.id, cantidad: String(input.cantidadKg) })
      .onConflictDoUpdate({ target: [saldo.depositoId, saldo.materiaPrimaId], set: { cantidad: sql`${saldo.cantidad} + ${input.cantidadKg}` } });
    const [m] = await tx
      .insert(movimientoMaquina)
      .values({
        retiroMaquinaId: cab.id,
        tipo: "SOBRANTE",
        cantidad: String(input.cantidadKg),
        cicloId: cab.cicloId,
        materiaPrimaDestinoId: destino.id,
        movimientoId: mov.id,
        observaciones: [`Composición: ${composicion}`, input.observaciones?.trim()].filter(Boolean).join(" · "),
        usuarioId: actor.id,
        token: input.token || null,
      })
      .returning();
    return { id: m.id };
  });
}

// ---------------------------------------------------------------------------
// Conciliación y cierre del retiro
// ---------------------------------------------------------------------------

/**
 * Cierre definitivo: el saldo a pie de máquina de cada línea tiene que ser
 * cero. Lo que no cierra se registra como DIFERENCIA con su justificación
 * (obligatoria); no se modifica ninguna cantidad ya registrada.
 */
export async function cerrarRetiro(
  actor: Actor,
  retiroMaquinaId: number,
  justificaciones: Record<number, string>,
): Promise<Resultado & { pendientes?: { retiroMpId: number; pie: number }[] }> {
  if (!puedeRetirarMateriaPrima(actor.rol)) return { error: "No tenés permiso para cerrar retiros." };
  return db.transaction(async (tx) => {
    const [cab] = await tx.select().from(retiroMaquina).where(eq(retiroMaquina.id, retiroMaquinaId)).for("update");
    if (!cab) return { error: "Retiro no encontrado." };
    if (cab.estado === "CERRADO") return { error: `El retiro ${numeroRetiro(cab.id)} ya está cerrado.` };
    const lineas = await tx.select().from(retiroMp).where(eq(retiroMp.retiroMaquinaId, cab.id)).for("update");
    const saldos = await saldosDeLineas(tx, lineas.map((l) => l.id));
    const pendientes = [...saldos.values()].filter((s) => Math.abs(s.pie) > EPS).map((s) => ({ retiroMpId: s.retiroMpId, pie: s.pie }));
    const sinJustificar = pendientes.filter((p) => !justificaciones[p.retiroMpId]?.trim());
    if (sinJustificar.length > 0) {
      return {
        error: `Quedan ${sinJustificar.length} material(es) a pie de máquina sin cargar ni devolver. Cargalos, devolvelos o justificá la diferencia para cerrar.`,
        pendientes: sinJustificar,
      };
    }
    for (const p of pendientes) {
      await tx.insert(movimientoMaquina).values({
        retiroMaquinaId: cab.id,
        retiroMpId: p.retiroMpId,
        tipo: "DIFERENCIA",
        cantidad: String(p.pie),
        cicloId: cab.cicloId,
        observaciones: justificaciones[p.retiroMpId].trim(),
        usuarioId: actor.id,
      });
    }
    await tx.update(retiroMaquina).set({ estado: "CERRADO", cerradoPorId: actor.id, cerradoEn: new Date() }).where(eq(retiroMaquina.id, cab.id));
    await registrarCambios(tx, actor.id, [
      {
        entidad: "retiro_maquina",
        entidadId: cab.id,
        campo: "estado",
        anterior: "ABIERTO",
        nuevo: "CERRADO",
        motivo: pendientes.length ? pendientes.map((p) => `línea ${p.retiroMpId}: ${p.pie} kg — ${justificaciones[p.retiroMpId].trim()}`).join(" · ") : "Conciliado sin diferencias",
      },
    ]);
    return {};
  });
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type RetiroDetalle = Awaited<ReturnType<typeof obtenerRetirosMaquina>>[number];

/** Retiros con sus líneas, saldos y movimientos (filtrables). */
export async function obtenerRetirosMaquina(filtro: { ids?: number[]; estado?: "ABIERTO" | "CERRADO"; cicloId?: number; inyectora?: string; limite?: number } = {}) {
  const operario = usuario;
  const cabeceras = await db
    .select({
      r: retiroMaquina,
      operarioNombre: operario.nombre,
      productoCodigo: producto.codigo,
      productoKg: producto.kgPorUnidad,
      partidaNumero: partida.numero,
      cicloAbierto: sql<boolean>`${cicloProduccion.fechaFin} is null`,
    })
    .from(retiroMaquina)
    .leftJoin(operario, eq(retiroMaquina.operarioId, operario.id))
    .leftJoin(cicloProduccion, eq(retiroMaquina.cicloId, cicloProduccion.id))
    .leftJoin(producto, eq(retiroMaquina.productoPrevistoId, producto.id))
    .leftJoin(partida, eq(cicloProduccion.partidaId, partida.id))
    .where(
      and(
        filtro.ids ? inArray(retiroMaquina.id, filtro.ids.length ? filtro.ids : [-1]) : undefined,
        filtro.estado ? eq(retiroMaquina.estado, filtro.estado) : undefined,
        filtro.inyectora ? eq(retiroMaquina.inyectora, filtro.inyectora) : undefined,
        filtro.cicloId
          ? sql`(${retiroMaquina.cicloId} = ${filtro.cicloId} or exists (select 1 from ${movimientoMaquina} mm where mm.retiro_maquina_id = ${retiroMaquina.id} and mm.ciclo_id = ${filtro.cicloId}))`
          : undefined,
      ),
    )
    .orderBy(desc(retiroMaquina.id))
    .limit(filtro.limite ?? 100);
  if (cabeceras.length === 0) return [];
  const ids = cabeceras.map((c) => c.r.id);
  const lineas = await db
    .select({
      id: retiroMp.id,
      retiroMaquinaId: retiroMp.retiroMaquinaId,
      materiaPrimaId: retiroMp.materiaPrimaId,
      materiaPrimaNombre: materiaPrima.nombre,
      materiaPrimaTipo: materiaPrima.tipo,
      loteMpId: retiroMp.loteMpId,
      loteCodigo: loteMp.codigoBarra,
      numeroLote: loteMp.numeroLote,
      certificadoNumero: certificadoCalidad.numeroCorrelativo,
      codigoLeido: retiroMp.codigoLeido,
      cantidad: retiroMp.cantidad,
      anulado: retiroMp.anulado,
      anuladoMotivo: retiroMp.anuladoMotivo,
    })
    .from(retiroMp)
    .innerJoin(materiaPrima, eq(retiroMp.materiaPrimaId, materiaPrima.id))
    .leftJoin(loteMp, eq(retiroMp.loteMpId, loteMp.id))
    .leftJoin(certificadoCalidad, eq(loteMp.certificadoId, certificadoCalidad.id))
    .where(inArray(retiroMp.retiroMaquinaId, ids))
    .orderBy(asc(retiroMp.id));
  const saldos = await saldosDeLineas(db, lineas.map((l) => l.id));
  const destino = materiaPrima;
  const movs = await db
    .select({
      id: movimientoMaquina.id,
      retiroMaquinaId: movimientoMaquina.retiroMaquinaId,
      retiroMpId: movimientoMaquina.retiroMpId,
      tipo: movimientoMaquina.tipo,
      cantidad: movimientoMaquina.cantidad,
      cicloId: movimientoMaquina.cicloId,
      destinoNombre: destino.nombre,
      observaciones: movimientoMaquina.observaciones,
      usuarioNombre: usuario.nombre,
      fecha: movimientoMaquina.fecha,
      anulado: movimientoMaquina.anulado,
      anuladoMotivo: movimientoMaquina.anuladoMotivo,
    })
    .from(movimientoMaquina)
    .innerJoin(usuario, eq(movimientoMaquina.usuarioId, usuario.id))
    .leftJoin(destino, eq(movimientoMaquina.materiaPrimaDestinoId, destino.id))
    .where(inArray(movimientoMaquina.retiroMaquinaId, ids))
    .orderBy(asc(movimientoMaquina.fecha), asc(movimientoMaquina.id));

  return cabeceras.map((c) => {
    const ls = lineas
      .filter((l) => l.retiroMaquinaId === c.r.id)
      .map((l) => ({ ...l, cantidad: Number(l.cantidad), saldo: saldos.get(l.id)! }));
    const ms = movs.filter((m) => m.retiroMaquinaId === c.r.id).map((m) => ({ ...m, cantidad: Number(m.cantidad) }));
    const sobrante = ms.filter((m) => m.tipo === "SOBRANTE" && !m.anulado).reduce((t, m) => t + m.cantidad, 0);
    const tot = (k: keyof SaldoLinea) => r3(ls.reduce((t, l) => t + (l.saldo[k] as number), 0));
    return {
      ...c.r,
      numero: numeroRetiro(c.r.id),
      operarioNombre: c.operarioNombre,
      productoCodigo: c.productoCodigo,
      productoKgPorUnidad: c.productoKg != null ? Number(c.productoKg) : null,
      partidaNumero: c.partidaNumero,
      cicloAbierto: c.cicloAbierto,
      lineas: ls,
      movimientos: ms,
      totales: { retirado: tot("retirado"), cargado: tot("cargado"), devuelto: tot("devuelto"), diferencia: tot("diferencia"), pie: tot("pie"), sobrante: r3(sobrante) },
    };
  });
}

// ---------------------------------------------------------------------------
// Control de material por ciclo
// ---------------------------------------------------------------------------

export type ControlMaterial = Awaited<ReturnType<typeof controlMaterialCiclo>>;

/**
 * Retirado vs cargado vs producido para un ciclo. El rendimiento teórico usa el
 * peso por pieza del producto (kg_por_unidad); si falta, se informa como dato
 * faltante en vez de estimarlo.
 */
export async function controlMaterialCiclo(cicloId: number) {
  const [c] = await db
    .select({
      ciclo: cicloProduccion,
      kgPorUnidad: producto.kgPorUnidad,
      productoCodigo: producto.codigo,
    })
    .from(cicloProduccion)
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .where(eq(cicloProduccion.id, cicloId));
  if (!c) return null;
  const movs = await db
    .select({ tipo: movimientoMaquina.tipo, cantidad: movimientoMaquina.cantidad, mpTipo: materiaPrima.tipo })
    .from(movimientoMaquina)
    .leftJoin(retiroMp, eq(movimientoMaquina.retiroMpId, retiroMp.id))
    .leftJoin(materiaPrima, eq(retiroMp.materiaPrimaId, materiaPrima.id))
    .where(and(eq(movimientoMaquina.cicloId, cicloId), eq(movimientoMaquina.anulado, false)));
  const suma = (f: (m: (typeof movs)[number]) => boolean) => r3(movs.filter(f).reduce((t, m) => t + Number(m.cantidad), 0));
  const retirosDelCiclo = await db
    .select({ cantidad: retiroMp.cantidad, mpTipo: materiaPrima.tipo, enCircuito: sql<boolean>`${retiroMp.retiroMaquinaId} is not null` })
    .from(retiroMp)
    .innerJoin(materiaPrima, eq(retiroMp.materiaPrimaId, materiaPrima.id))
    .where(and(eq(retiroMp.cicloId, cicloId), eq(retiroMp.anulado, false)));
  // Retiros anteriores al circuito de pie de máquina: se consumieron directo.
  const legado = r3(retirosDelCiclo.filter((r) => !r.enCircuito).reduce((t, r) => t + Number(r.cantidad), 0));
  const retirado = r3(retirosDelCiclo.reduce((t, r) => t + Number(r.cantidad), 0));
  const cargadoVirgen = r3(suma((m) => m.tipo === "CARGA_TOLVA" && m.mpTipo !== "MASTER") + retirosDelCiclo.filter((r) => !r.enCircuito && r.mpTipo !== "MASTER").reduce((t, r) => t + Number(r.cantidad), 0));
  const masterIncorporado = r3(suma((m) => m.tipo === "CARGA_TOLVA" && m.mpTipo === "MASTER") + retirosDelCiclo.filter((r) => !r.enCircuito && r.mpTipo === "MASTER").reduce((t, r) => t + Number(r.cantidad), 0));
  const cargado = r3(cargadoVirgen + masterIncorporado);
  const devuelto = suma((m) => m.tipo === "DEVOLUCION");
  const sobrante = suma((m) => m.tipo === "SOBRANTE");
  const kg = c.kgPorUnidad != null && Number(c.kgPorUnidad) > 0 ? Number(c.kgPorUnidad) : null;
  const producidas = c.ciclo.piezasProducidas;
  const buenas = c.ciclo.piezasEntregadas;
  const descarte = c.ciclo.piezasDescartadas;
  const teoricas = kg ? Math.floor((cargado - sobrante) / kg) : null;
  const residuos = r3(Number(c.ciclo.coladaKg ?? 0) + Number(c.ciclo.rebarbaKg ?? 0) + Number(c.ciclo.scrapKg ?? 0));
  const consumoProducido = kg && producidas != null ? r3(producidas * kg) : null;
  const diferenciaKg = consumoProducido != null && c.ciclo.fechaFin ? r3(cargado - sobrante - consumoProducido - residuos) : null;
  return {
    cicloId,
    cerrado: c.ciclo.fechaFin != null,
    retirado,
    legado,
    cargado,
    cargadoVirgen,
    masterIncorporado,
    devuelto,
    sobrante,
    kgPorPieza: kg,
    faltaDato: kg == null ? `${c.productoCodigo ?? "El producto"} no tiene configurado el peso por pieza (Panel Admin → Productos).` : null,
    piezasTeoricas: teoricas,
    piezasProducidas: producidas,
    piezasBuenas: buenas,
    piezasDescartadas: descarte,
    residuosKg: residuos,
    consumoProducidoKg: consumoProducido,
    /** cargado − sobrante − (producidas × peso) − colada/rebarba/scrap. */
    diferenciaKg,
  };
}

/** Retiros abiertos por inyectora: lo que hay a pie de máquina ahora. */
export async function pieDeMaquina() {
  const abiertos = await obtenerRetirosMaquina({ estado: "ABIERTO" });
  return abiertos;
}

/** Ciclos abiertos de una inyectora (para cargar material). */
export async function ciclosAbiertos() {
  return db
    .select({ id: cicloProduccion.id, inyectora: cicloProduccion.inyectora, productoCodigo: producto.codigo, partidaNumero: partida.numero, partidaId: cicloProduccion.partidaId, fechaInicio: cicloProduccion.fechaInicio })
    .from(cicloProduccion)
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .leftJoin(partida, eq(cicloProduccion.partidaId, partida.id))
    .where(isNull(cicloProduccion.fechaFin))
    .orderBy(desc(cicloProduccion.fechaInicio));
}
