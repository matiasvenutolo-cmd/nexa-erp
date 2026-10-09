/**
 * Correcciones de Supervisión por errores de carga en inyección y materia
 * prima (requerimiento de octubre 2026). Reglas comunes:
 *  - sólo el Supervisor (puedeCorregirProduccionMp) y con motivo obligatorio;
 *  - nada se borra: lo anulado queda marcado y visible;
 *  - si la corrección toca stock, se regulariza con un movimiento propio en la
 *    misma transacción (ledger), nunca editando movimientos existentes;
 *  - cada cambio queda en auditoría con valor anterior, nuevo, motivo, usuario
 *    y fecha/hora.
 */
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  caja,
  cicloMateriaPrima,
  cicloProduccion,
  despacho,
  loteMp,
  materiaPrima,
  movimiento,
  movimientoMaquina,
  piqueo,
  retiroMaquina,
  retiroMp,
  saldo,
} from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { puedeCorregirProduccionMp } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { disponibleDeLotes, numeroRetiro } from "@/lib/data/maquina";
import { generarCajas } from "@/lib/data/produccion";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const EPS = 1e-6;

class ErrorCorreccion extends Error {}

function exigir(actor: Actor, motivo: string | null | undefined): string | { error: string } {
  if (!puedeCorregirProduccionMp(actor.rol)) return { error: "Sólo Supervisión puede corregir datos de inyección y materia prima." };
  const m = motivo?.trim();
  if (!m) return { error: "Indicá el motivo de la corrección: queda registrado." };
  return m;
}

async function moverMp(tx: Tx, depositoId: number, actor: Actor, mpId: number, delta: number, motivo: string, extra: { loteMpId?: number | null; origenId?: number | null } = {}) {
  const [s] = await tx
    .select({ cantidad: saldo.cantidad })
    .from(saldo)
    .where(and(eq(saldo.depositoId, depositoId), eq(saldo.materiaPrimaId, mpId)))
    .for("update");
  if (Number(s?.cantidad ?? 0) + delta < -EPS) throw new ErrorCorreccion(`El stock de la materia prima no alcanza para regularizar (${Number(s?.cantidad ?? 0)} kg).`);
  await tx.insert(movimiento).values({
    tipo: delta >= 0 ? "ENTRADA" : "SALIDA",
    depositoId,
    materiaPrimaId: mpId,
    loteMpId: extra.loteMpId ?? null,
    cantidad: String(Math.abs(delta)),
    origen: "MANUAL",
    origenId: extra.origenId ?? null,
    motivo,
    usuarioId: actor.id,
  });
  await tx
    .insert(saldo)
    .values({ depositoId, materiaPrimaId: mpId, cantidad: String(delta) })
    .onConflictDoUpdate({ target: [saldo.depositoId, saldo.materiaPrimaId], set: { cantidad: sql`${saldo.cantidad} + ${delta}` } });
}

function ejecutar<T extends Resultado>(fn: (tx: Tx) => Promise<T>): Promise<T | { error: string }> {
  return db.transaction(fn).catch((e) => {
    if (e instanceof ErrorCorreccion) return { error: e.message };
    throw e;
  });
}

/** Anula una línea de retiro cargada por error: el material vuelve al depósito. */
export async function anularLineaRetiro(actor: Actor, retiroMpId: number, motivo: string | null): Promise<Resultado> {
  const m = exigir(actor, motivo);
  if (typeof m !== "string") return m;
  const depositoId = await getDepositoNexaId();
  return ejecutar(async (tx) => {
    const [l] = await tx.select().from(retiroMp).where(eq(retiroMp.id, retiroMpId)).for("update");
    if (!l) return { error: "Línea de retiro no encontrada." };
    if (l.anulado) return { error: "La línea ya está anulada." };
    if (l.retiroMaquinaId) {
      const vivos = await tx
        .select({ id: movimientoMaquina.id })
        .from(movimientoMaquina)
        .where(and(eq(movimientoMaquina.retiroMpId, l.id), eq(movimientoMaquina.anulado, false)));
      if (vivos.length) return { error: "La línea tiene cargas o devoluciones registradas: anulalas primero." };
    } else if (l.cicloId) {
      // Retiro anterior al circuito de pie de máquina: se había vinculado al ciclo al retirar.
      const [cmp] = await tx
        .select({ id: cicloMateriaPrima.id })
        .from(cicloMateriaPrima)
        .where(
          and(
            eq(cicloMateriaPrima.cicloId, l.cicloId),
            eq(cicloMateriaPrima.materiaPrimaId, l.materiaPrimaId),
            l.loteMpId ? eq(cicloMateriaPrima.loteMpId, l.loteMpId) : isNull(cicloMateriaPrima.loteMpId),
            eq(cicloMateriaPrima.cantidadKg, l.cantidad),
            isNull(cicloMateriaPrima.movimientoMaquinaId),
          ),
        )
        .limit(1);
      if (cmp) await tx.delete(cicloMateriaPrima).where(eq(cicloMateriaPrima.id, cmp.id));
    }
    const cantidad = Number(l.cantidad);
    await moverMp(tx, depositoId, actor, l.materiaPrimaId, cantidad, `Anulación de retiro (línea ${l.id}${l.retiroMaquinaId ? `, ${numeroRetiro(l.retiroMaquinaId)}` : ""}): ${m}`, {
      loteMpId: l.loteMpId,
      origenId: l.id,
    });
    await tx.update(retiroMp).set({ anulado: true, anuladoPorId: actor.id, anuladoEn: new Date(), anuladoMotivo: m }).where(eq(retiroMp.id, l.id));
    await registrarCambios(tx, actor.id, [
      { entidad: "retiro_mp", entidadId: l.id, campo: "anulación", anterior: `${cantidad} kg retirados`, nuevo: "anulado (vuelve al depósito)", motivo: m },
    ]);
    return {};
  });
}

/** Anula una carga, devolución, sobrante o diferencia registrada por error. */
export async function anularMovimientoMaquina(actor: Actor, id: number, motivo: string | null): Promise<Resultado> {
  const m = exigir(actor, motivo);
  if (typeof m !== "string") return m;
  const depositoId = await getDepositoNexaId();
  return ejecutar(async (tx) => {
    const [mm] = await tx.select().from(movimientoMaquina).where(eq(movimientoMaquina.id, id)).for("update");
    if (!mm) return { error: "Movimiento no encontrado." };
    if (mm.anulado) return { error: "El movimiento ya está anulado." };
    const [cab] = await tx.select().from(retiroMaquina).where(eq(retiroMaquina.id, mm.retiroMaquinaId)).for("update");
    const cantidad = Number(mm.cantidad);

    if (mm.tipo === "CARGA_TOLVA") {
      await tx.delete(cicloMateriaPrima).where(eq(cicloMateriaPrima.movimientoMaquinaId, mm.id));
    }
    if ((mm.tipo === "DEVOLUCION" || mm.tipo === "SOBRANTE") && mm.movimientoId) {
      const [orig] = await tx.select().from(movimiento).where(eq(movimiento.id, mm.movimientoId));
      await moverMp(tx, depositoId, actor, orig.materiaPrimaId!, -cantidad, `Anulación de ${mm.tipo === "DEVOLUCION" ? "devolución" : "sobrante"} del ${numeroRetiro(cab.id)}: ${m}`, {
        loteMpId: orig.loteMpId,
        origenId: mm.id,
      });
    }
    await tx.update(movimientoMaquina).set({ anulado: true, anuladoPorId: actor.id, anuladoEn: new Date(), anuladoMotivo: m }).where(eq(movimientoMaquina.id, mm.id));
    // Si cambia lo que hay a pie de máquina, un retiro cerrado vuelve a quedar abierto.
    const reabre = cab.estado === "CERRADO" && mm.tipo !== "SOBRANTE";
    if (reabre) await tx.update(retiroMaquina).set({ estado: "ABIERTO", cerradoPorId: null, cerradoEn: null }).where(eq(retiroMaquina.id, cab.id));
    await registrarCambios(tx, actor.id, [
      { entidad: "movimiento_maquina", entidadId: mm.id, campo: "anulación", anterior: `${mm.tipo} ${cantidad} kg`, nuevo: "anulado", motivo: m },
      ...(reabre ? [{ entidad: "retiro_maquina", entidadId: cab.id, campo: "estado", anterior: "CERRADO", nuevo: "ABIERTO", motivo: `Reapertura por anulación: ${m}` }] : []),
    ]);
    return {};
  });
}

export type CorreccionCierre = {
  golpesFin?: number | null;
  piezasDescartadas?: number | null;
  piezasEntregadas?: number | null;
  coladaKg?: string | null;
  rebarbaKg?: string | null;
  scrapKg?: string | null;
  observaciones?: string | null;
};

/**
 * Corrige el cierre de un ciclo. Si cambian las piezas que entraron a stock,
 * la diferencia se regulariza con un movimiento y en las cajas del ciclo (se
 * agregan cajas, o se descuenta de cajas que no fueron armadas).
 */
export async function corregirCierreCiclo(actor: Actor, cicloId: number, cambios: CorreccionCierre, motivo: string | null): Promise<Resultado> {
  const m = exigir(actor, motivo);
  if (typeof m !== "string") return m;
  const depositoId = await getDepositoNexaId();
  return ejecutar(async (tx) => {
    const [c] = await tx.select().from(cicloProduccion).where(eq(cicloProduccion.id, cicloId)).for("update");
    if (!c) return { error: "Ciclo no encontrado." };
    if (!c.fechaFin) return { error: "El ciclo está abierto: se corrige en su cierre normal." };
    const nuevo = { ...c };
    if (cambios.golpesFin !== undefined) {
      if (cambios.golpesFin != null && c.golpesInicio != null && cambios.golpesFin < c.golpesInicio) return { error: "Los golpes de fin no pueden ser menores que los de inicio." };
      nuevo.golpesFin = cambios.golpesFin;
      nuevo.piezasProducidas =
        cambios.golpesFin != null && c.golpesInicio != null && c.piezasPorGolpe != null ? (cambios.golpesFin - c.golpesInicio) * c.piezasPorGolpe : c.piezasProducidas;
    }
    for (const k of ["piezasDescartadas", "piezasEntregadas", "coladaKg", "rebarbaKg", "scrapKg", "observaciones"] as const) {
      if (cambios[k] !== undefined) (nuevo as Record<string, unknown>)[k] = cambios[k];
    }
    if (nuevo.piezasEntregadas == null || !Number.isInteger(nuevo.piezasEntregadas) || nuevo.piezasEntregadas < 0) {
      return { error: "Las piezas que entran a stock tienen que ser un entero mayor o igual a cero." };
    }
    if (nuevo.piezasProducidas != null && nuevo.piezasEntregadas > nuevo.piezasProducidas) {
      return { error: `Las piezas a stock (${nuevo.piezasEntregadas}) no pueden superar las producidas (${nuevo.piezasProducidas}).` };
    }

    const delta = nuevo.piezasEntregadas - (c.piezasEntregadas ?? 0);
    if (delta !== 0 && c.productoId != null) {
      const [s] = await tx
        .select({ cantidad: saldo.cantidad })
        .from(saldo)
        .where(and(eq(saldo.depositoId, depositoId), eq(saldo.productoId, c.productoId)))
        .for("update");
      if (delta < 0) {
        // Sólo se puede quitar de cajas del ciclo que no estén comprometidas.
        let resta = -delta;
        const cajas = await tx.select().from(caja).where(and(eq(caja.cicloId, c.id), ne(caja.estado, "BAJA"))).orderBy(desc(caja.numeroCaja));
        const usados = cajas.length
          ? await tx
              .select({ cajaId: piqueo.cajaId, total: sql<number>`coalesce(sum(${piqueo.cantidad}), 0)`.mapWith(Number) })
              .from(piqueo)
              .innerJoin(despacho, eq(piqueo.despachoId, despacho.id))
              .where(and(inArray(piqueo.cajaId, cajas.map((x) => x.id)), eq(piqueo.tipo, "ARMADO"), eq(piqueo.conAlerta, false), ne(despacho.estado, "ANULADO")))
              .groupBy(piqueo.cajaId)
          : [];
        for (const cj of cajas) {
          if (resta === 0) break;
          const libre = cj.cantidad - (usados.find((u) => u.cajaId === cj.id)?.total ?? 0);
          const quita = Math.min(libre, resta);
          if (quita <= 0) continue;
          const queda = cj.cantidad - quita;
          await tx.update(caja).set({ cantidad: queda, ...(queda === 0 ? { estado: "BAJA" as const } : {}) }).where(eq(caja.id, cj.id));
          resta -= quita;
        }
        if (resta > 0) throw new ErrorCorreccion(`Las cajas del ciclo ya están armadas o despachadas: sólo se pueden descontar ${-delta - resta} piezas.`);
        if (Number(s?.cantidad ?? 0) + delta < 0) throw new ErrorCorreccion("El stock del producto no alcanza para descontar la corrección.");
      } else if (c.partidaId != null) {
        await generarCajas(tx, { cicloId: c.id, partidaId: c.partidaId, productoId: c.productoId, piezas: delta });
      }
      await tx.insert(movimiento).values({
        tipo: "AJUSTE",
        depositoId,
        productoId: c.productoId,
        partidaId: c.partidaId,
        cantidad: String(delta),
        origen: "CICLO",
        origenId: c.id,
        motivo: `Corrección de Supervisión del cierre del ciclo #${c.id}: ${m}`,
        usuarioId: actor.id,
      });
      await tx
        .insert(saldo)
        .values({ depositoId, productoId: c.productoId, cantidad: String(delta) })
        .onConflictDoUpdate({ target: [saldo.depositoId, saldo.productoId], set: { cantidad: sql`${saldo.cantidad} + ${delta}` } });
    }

    const campos = ["golpesFin", "piezasProducidas", "piezasDescartadas", "piezasEntregadas", "coladaKg", "rebarbaKg", "scrapKg", "observaciones"] as const;
    const cambiosAudit = campos
      .filter((k) => String(c[k] ?? "") !== String(nuevo[k] ?? ""))
      .map((k) => ({ entidad: "ciclo_produccion", entidadId: c.id, campo: k, anterior: c[k] == null ? null : String(c[k]), nuevo: nuevo[k] == null ? null : String(nuevo[k]), motivo: m }));
    if (cambiosAudit.length === 0) return { error: "No hay cambios para corregir." };
    await tx
      .update(cicloProduccion)
      .set({
        golpesFin: nuevo.golpesFin,
        piezasProducidas: nuevo.piezasProducidas,
        piezasDescartadas: nuevo.piezasDescartadas,
        piezasEntregadas: nuevo.piezasEntregadas,
        coladaKg: nuevo.coladaKg,
        rebarbaKg: nuevo.rebarbaKg,
        scrapKg: nuevo.scrapKg,
        observaciones: nuevo.observaciones,
      })
      .where(eq(cicloProduccion.id, c.id));
    await registrarCambios(tx, actor.id, cambiosAudit);
    return {};
  });
}

/** Corrige los kg ingresados de un lote (error de carga del ingreso). */
export async function corregirIngresoLote(actor: Actor, loteId: number, nuevaCantidadKg: number, motivo: string | null): Promise<Resultado> {
  const m = exigir(actor, motivo);
  if (typeof m !== "string") return m;
  if (!Number.isFinite(nuevaCantidadKg) || nuevaCantidadKg <= 0) return { error: "La cantidad ingresada tiene que ser mayor que cero." };
  const depositoId = await getDepositoNexaId();
  return ejecutar(async (tx) => {
    const [l] = await tx.select().from(loteMp).where(eq(loteMp.id, loteId)).for("update");
    if (!l) return { error: "Lote no encontrado." };
    const delta = Math.round((nuevaCantidadKg - Number(l.cantidadIngresada)) * 1000) / 1000;
    if (delta === 0) return { error: "La cantidad es la misma." };
    const disponible = (await disponibleDeLotes(tx, [l.id])).get(l.id) ?? 0;
    if (disponible + delta < -EPS) return { error: `Del lote ya se retiraron más kg: el ingreso no puede ser menor que ${Number(l.cantidadIngresada) - disponible} kg.` };
    const [mp] = await tx.select({ nombre: materiaPrima.nombre }).from(materiaPrima).where(eq(materiaPrima.id, l.materiaPrimaId));
    await moverMp(tx, depositoId, actor, l.materiaPrimaId, delta, `Corrección de Supervisión del ingreso del lote ${l.numeroLote} (${mp.nombre}): ${m}`, { loteMpId: l.id, origenId: l.id });
    await tx.update(loteMp).set({ cantidadIngresada: String(nuevaCantidadKg) }).where(eq(loteMp.id, l.id));
    await registrarCambios(tx, actor.id, [
      { entidad: "lote_mp", entidadId: l.id, campo: "cantidad_ingresada", anterior: `${Number(l.cantidadIngresada)} kg`, nuevo: `${nuevaCantidadKg} kg`, motivo: m },
    ]);
    return {};
  });
}

