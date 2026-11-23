/**
 * Conteo físico semanal de materia prima (listado del 7/11/2026): el
 * responsable de MP cuenta los materiales y lo vuelca al lado del stock
 * teórico, como en su Excel: stock a la fecha (sale de los movimientos), stock
 * físico, diferencia y justificación. Queda guardado con su fecha. Si se pide,
 * el stock del sistema se ajusta al conteo con un movimiento de inventario por
 * material (el ledger explica la diferencia).
 */
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inventarioFisico, inventarioLinea, materiaPrima, movimiento, saldo, usuario } from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { compararCodigoMp, ordenTipoMp } from "@/lib/codigos-mp";
import { aGramos } from "@/lib/presentaciones";
import type { usuario as usuarioT } from "@/lib/db/schema";

type Rol = (typeof usuarioT.$inferSelect)["rol"];
// Cambios del 23/11/2026: el conteo físico es de Materia prima (el Encargado ya no).
const ROLES_CONTEO: readonly Rol[] = ["MATERIA_PRIMA", "SUPERVISOR", "GERENCIA"];
export const puedeContarMp = (rol: Rol) => ROLES_CONTEO.includes(rol);

const depositoGeneral = getDepositoNexaId;

/** Stock teórico de cada material en el stock general al cierre del día (sale de los movimientos). */
export async function stockMpALaFecha(fecha: string): Promise<Map<number, number>> {
  const dep = await depositoGeneral();
  const filas = await db
    .select({
      mp: movimiento.materiaPrimaId,
      kg: sql<number>`coalesce(sum(case when ${movimiento.tipo} = 'ENTRADA' then abs(${movimiento.cantidad}) when ${movimiento.tipo} = 'SALIDA' then -abs(${movimiento.cantidad}) else ${movimiento.cantidad} end), 0)`.mapWith(Number),
    })
    .from(movimiento)
    .where(and(eq(movimiento.depositoId, dep), sql`${movimiento.materiaPrimaId} is not null`, lte(movimiento.fecha, new Date(`${fecha}T23:59:59.999-03:00`))))
    .groupBy(movimiento.materiaPrimaId);
  return new Map(filas.map((f) => [f.mp!, Math.round(f.kg * 1000) / 1000]));
}

/** Materiales para el formulario de conteo, con su stock teórico a la fecha. */
export async function planillaConteo(fecha: string) {
  const [mps, teorico] = await Promise.all([
    db.select({ id: materiaPrima.id, codigo: materiaPrima.codigoInterno, nombre: materiaPrima.nombre, tipo: materiaPrima.tipo }).from(materiaPrima).where(eq(materiaPrima.activo, true)),
    stockMpALaFecha(fecha),
  ]);
  return mps
    .sort((a, b) => ordenTipoMp(a.tipo) - ordenTipoMp(b.tipo) || compararCodigoMp(a.codigo, b.codigo))
    .map((m) => ({ ...m, teorico: teorico.get(m.id) ?? 0 }));
}

export type LineaConteoInput = { materiaPrimaId: number; contado: number; motivo?: string | null };

/**
 * Guarda el conteo de un día. Los materiales sin contar no se guardan. Con
 * diferencia, la justificación es obligatoria. `ajustar`: el stock del sistema
 * pasa a ser lo contado (un ajuste de inventario por material).
 */
export async function registrarConteoMp(actor: Actor, input: { fecha: string; lineas: LineaConteoInput[]; observaciones?: string | null; ajustar?: boolean }): Promise<Resultado & { id?: number; diferencias?: number }> {
  if (!puedeContarMp(actor.rol)) return { error: "El conteo físico lo carga Materia prima." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fecha)) return { error: "Indicá la fecha del recuento." };
  const lineas = input.lineas.filter((l) => Number.isFinite(l.contado));
  if (lineas.length === 0) return { error: "Cargá el stock físico de al menos un material." };
  if (lineas.some((l) => l.contado < 0)) return { error: "El stock físico no puede ser negativo." };
  const teorico = await stockMpALaFecha(input.fecha);
  const conDif = lineas.map((l) => ({ ...l, teorico: teorico.get(l.materiaPrimaId) ?? 0 })).map((l) => ({ ...l, dif: (aGramos(l.contado) - aGramos(l.teorico)) / 1000 }));
  const sinMotivo = conDif.filter((l) => l.dif !== 0 && !l.motivo?.trim());
  if (sinMotivo.length) return { error: `Justificá la diferencia de ${sinMotivo.length === 1 ? "1 material" : `${sinMotivo.length} materiales`}.` };
  const dep = await depositoGeneral();
  const clave = (ls: { materiaPrimaId: number; contado: number }[]) => ls.map((l) => `${l.materiaPrimaId}:${aGramos(l.contado)}`).sort().join("|");
  return db.transaction(async (tx) => {
    // Doble envío: el mismo conteo (fecha, materiales y cantidades) ya guardado no se repite.
    const previos = await tx.select({ id: inventarioFisico.id }).from(inventarioFisico).where(and(eq(inventarioFisico.depositoId, dep), eq(inventarioFisico.fecha, input.fecha)));
    if (previos.length) {
      const lp = await tx.select({ inv: inventarioLinea.inventarioId, materiaPrimaId: inventarioLinea.materiaPrimaId, contado: inventarioLinea.cantidadContada }).from(inventarioLinea).where(inArray(inventarioLinea.inventarioId, previos.map((p) => p.id)));
      const igual = previos.find((p) => clave(lp.filter((l) => l.inv === p.id).map((l) => ({ materiaPrimaId: l.materiaPrimaId!, contado: Number(l.contado) }))) === clave(lineas));
      if (igual) return { id: igual.id, diferencias: conDif.filter((l) => l.dif !== 0).length };
    }
    const [inv] = await tx
      .insert(inventarioFisico)
      .values({ depositoId: dep, fecha: input.fecha, estado: "CERRADO", responsableId: actor.id, observaciones: input.observaciones?.trim() || null, cerradoEn: new Date() })
      .returning({ id: inventarioFisico.id });
    await tx.insert(inventarioLinea).values(
      conDif.map((l) => ({ inventarioId: inv.id, materiaPrimaId: l.materiaPrimaId, cantidadSistema: String(l.teorico), cantidadContada: String(l.contado), motivo: l.motivo?.trim() || null })),
    );
    if (input.ajustar) {
      // Ajuste contra el saldo de hoy (el stock teórico a la fecha puede ser de un día anterior).
      for (const l of conDif) {
        if (l.dif === 0) continue;
        await tx.insert(movimiento).values({ tipo: "AJUSTE", depositoId: dep, materiaPrimaId: l.materiaPrimaId, cantidad: String(l.dif), origen: "INVENTARIO", origenId: inv.id, motivo: `Conteo físico del ${input.fecha.split("-").reverse().join("/")}: ${l.motivo?.trim()}`, usuarioId: actor.id });
        await tx
          .insert(saldo)
          .values({ depositoId: dep, materiaPrimaId: l.materiaPrimaId, cantidad: String(l.dif) })
          .onConflictDoUpdate({ target: [saldo.depositoId, saldo.materiaPrimaId], set: { cantidad: sql`${saldo.cantidad} + ${l.dif}` } });
      }
    }
    await registrarCambios(tx, actor.id, [
      { entidad: "inventario_fisico", entidadId: inv.id, campo: "conteo de materia prima", anterior: null, nuevo: `${input.fecha} · ${lineas.length} materiales · ${conDif.filter((l) => l.dif !== 0).length} con diferencia${input.ajustar ? " · stock ajustado" : ""}` },
    ]);
    return { id: inv.id, diferencias: conDif.filter((l) => l.dif !== 0).length };
  });
}

/** Conteos anteriores con su comparativo. */
export async function conteosMp(limite = 10) {
  const dep = await depositoGeneral();
  const cab = await db
    .select({ id: inventarioFisico.id, fecha: inventarioFisico.fecha, observaciones: inventarioFisico.observaciones, responsable: usuario.nombre, cerradoEn: inventarioFisico.cerradoEn })
    .from(inventarioFisico)
    .innerJoin(usuario, eq(inventarioFisico.responsableId, usuario.id))
    .where(eq(inventarioFisico.depositoId, dep))
    .orderBy(desc(inventarioFisico.fecha), desc(inventarioFisico.id))
    .limit(limite);
  if (cab.length === 0) return [];
  const lineas = await db
    .select({ inventarioId: inventarioLinea.inventarioId, nombre: materiaPrima.nombre, codigo: materiaPrima.codigoInterno, sistema: inventarioLinea.cantidadSistema, contado: inventarioLinea.cantidadContada, motivo: inventarioLinea.motivo })
    .from(inventarioLinea)
    .innerJoin(materiaPrima, eq(inventarioLinea.materiaPrimaId, materiaPrima.id))
    .where(inArray(inventarioLinea.inventarioId, cab.map((c) => c.id)));
  return cab.map((c) => ({
    ...c,
    lineas: lineas
      .filter((l) => l.inventarioId === c.id)
      .map((l) => ({ ...l, sistema: Number(l.sistema), contado: Number(l.contado), diferencia: (aGramos(Number(l.contado)) - aGramos(Number(l.sistema))) / 1000 }))
      .sort((a, b) => compararCodigoMp(a.codigo, b.codigo)),
  }));
}
