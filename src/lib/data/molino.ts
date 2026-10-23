/**
 * Molino (perfil de Yesica Troncoso): recibe descartes, los muele, pesa cada
 * bolsón o canasto (pesos variables) y entrega la molienda a Materia Prima.
 * Recién cuando Materia Prima confirma la recepción entra al stock general,
 * como bolsón con código propio. El descarte no es stock; el sobrante
 * (material reutilizable sin moler) es otra cosa y se registra en su paso.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { cicloProduccion, descarteMolino, materiaPrima, moliendaEntrega, usuario } from "@/lib/db/schema";
import { puedeOperarMolino, puedeRecibirMolienda } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { ubicacionesMp } from "@/lib/data/depositos";
import { bolsonEnTx } from "@/lib/data/stock-mp";
import { ErrorStock } from "@/lib/data/ubicaciones";

export type EstadoMolienda = (typeof moliendaEntrega.$inferSelect)["estado"];
export const ESTADO_MOLIENDA_LABEL: Record<EstadoMolienda, string> = { ENTREGADA: "Entregada, falta confirmar", RECIBIDA: "Recibida en MP", RECHAZADA: "Rechazada" };

export async function recibirDescarte(actor: Actor, input: { origen: string; cicloId?: number | null; material: string; kg: number; observaciones?: string | null }): Promise<Resultado & { id?: number }> {
  if (!puedeOperarMolino(actor.rol)) return { error: "No tenés permiso para registrar en el molino." };
  if (!Number.isFinite(input.kg) || input.kg <= 0 || input.kg > 5000) return { error: "El peso tiene que estar entre 0 y 5.000 kg." };
  if (!input.origen.trim()) return { error: "Indicá de dónde viene el descarte (máquina, producción, armado…)." };
  if (!input.material.trim()) return { error: "Indicá el material o la composición del descarte." };
  if (input.cicloId) {
    const [c] = await db.select({ id: cicloProduccion.id }).from(cicloProduccion).where(eq(cicloProduccion.id, input.cicloId));
    if (!c) return { error: "La producción indicada no existe." };
  }
  return db.transaction(async (tx) => {
    const [d] = await tx
      .insert(descarteMolino)
      .values({ origen: input.origen.trim(), cicloId: input.cicloId ?? null, material: input.material.trim(), kg: String(input.kg), observaciones: input.observaciones?.trim() || null, recibidoPorId: actor.id })
      .returning();
    await registrarCambios(tx, actor.id, [{ entidad: "descarte_molino", entidadId: d.id, campo: "recepción", anterior: null, nuevo: `${input.kg} kg · ${d.material} · ${d.origen}` }]);
    return { id: d.id };
  });
}

export async function descartesPendientes() {
  return db
    .select({ d: descarteMolino, nombre: usuario.nombre })
    .from(descarteMolino)
    .innerJoin(usuario, eq(descarteMolino.recibidoPorId, usuario.id))
    .where(isNull(descarteMolino.moliendaEntregaId))
    .orderBy(asc(descarteMolino.fecha));
}

/** Molienda pesada y entregada a Materia Prima (todavía no es stock). */
export async function entregarMolienda(
  actor: Actor,
  input: { bolson: string; materiaPrimaId: number; kg: number; descarteIds?: number[]; observaciones?: string | null },
): Promise<Resultado & { id?: number }> {
  if (!puedeOperarMolino(actor.rol)) return { error: "No tenés permiso para registrar en el molino." };
  if (!input.bolson.trim()) return { error: "Identificá el bolsón o canasto (ej. n4)." };
  if (!Number.isFinite(input.kg) || input.kg <= 0 || input.kg > 3000) return { error: "El peso del bolsón tiene que estar entre 0 y 3.000 kg." };
  const [mp] = await db.select().from(materiaPrima).where(eq(materiaPrima.id, input.materiaPrimaId));
  if (!mp || mp.tipo !== "MOLIENDA") return { error: "Elegí un código de molienda (las moliendas se manejan aparte del sobrante)." };
  const ids = [...new Set(input.descarteIds ?? [])];
  return db.transaction(async (tx) => {
    if (ids.length) {
      const ds = await tx.select({ id: descarteMolino.id, usado: descarteMolino.moliendaEntregaId }).from(descarteMolino).where(inArray(descarteMolino.id, ids)).for("update");
      if (ds.length !== ids.length) return { error: "Algún descarte elegido no existe." };
      if (ds.some((d) => d.usado != null)) return { error: "Algún descarte elegido ya se usó en otra molienda." };
    }
    const [e] = await tx
      .insert(moliendaEntrega)
      .values({ bolson: input.bolson.trim(), materiaPrimaId: mp.id, kg: String(input.kg), observaciones: input.observaciones?.trim() || null, entregadoPorId: actor.id })
      .returning();
    if (ids.length) await tx.update(descarteMolino).set({ moliendaEntregaId: e.id }).where(inArray(descarteMolino.id, ids));
    await registrarCambios(tx, actor.id, [{ entidad: "molienda_entrega", entidadId: e.id, campo: "entrega", anterior: null, nuevo: `${input.kg} kg de ${mp.nombre} · bolsón ${e.bolson}` }]);
    return { id: e.id };
  });
}

export async function listarMoliendas(filtro: { estado?: EstadoMolienda; limite?: number } = {}) {
  const rec = alias(usuario, "recibe");
  return db
    .select({ e: moliendaEntrega, mpNombre: materiaPrima.nombre, entregaNombre: usuario.nombre, recibeNombre: rec.nombre })
    .from(moliendaEntrega)
    .innerJoin(materiaPrima, eq(moliendaEntrega.materiaPrimaId, materiaPrima.id))
    .innerJoin(usuario, eq(moliendaEntrega.entregadoPorId, usuario.id))
    .leftJoin(rec, eq(moliendaEntrega.recibidoPorId, rec.id))
    .where(filtro.estado ? eq(moliendaEntrega.estado, filtro.estado) : undefined)
    .orderBy(desc(moliendaEntrega.entregadoEn))
    .limit(filtro.limite ?? 100);
}

/**
 * Materia Prima confirma (entra al stock general como bolsón con código) o
 * rechaza (no entra; queda el motivo). Una entrega se confirma una sola vez.
 */
export async function confirmarMolienda(actor: Actor, id: number, input: { aceptar: boolean; kgRecibidos?: number | null; motivo?: string | null }): Promise<Resultado & { codigo?: string }> {
  if (!puedeRecibirMolienda(actor.rol)) return { error: "La recepción de la molienda la confirma Materia Prima." };
  if (!input.aceptar && !input.motivo?.trim()) return { error: "Indicá el motivo del rechazo." };
  const ub = await ubicacionesMp();
  try {
    return await db.transaction(async (tx) => {
      const [e] = await tx.select().from(moliendaEntrega).where(eq(moliendaEntrega.id, id)).for("update");
      if (!e) return { error: "Entrega no encontrada." };
      if (e.estado !== "ENTREGADA") return { error: "Esa entrega ya fue confirmada o rechazada." };
      if (!input.aceptar) {
        await tx.update(moliendaEntrega).set({ estado: "RECHAZADA", recibidoPorId: actor.id, recibidoEn: new Date() }).where(eq(moliendaEntrega.id, id));
        await registrarCambios(tx, actor.id, [{ entidad: "molienda_entrega", entidadId: id, campo: "estado", anterior: "ENTREGADA", nuevo: "RECHAZADA", motivo: input.motivo }]);
        return {};
      }
      const kg = input.kgRecibidos != null && input.kgRecibidos > 0 ? input.kgRecibidos : Number(e.kg);
      const [mp] = await tx.select().from(materiaPrima).where(eq(materiaPrima.id, e.materiaPrimaId));
      const r = await bolsonEnTx(tx, { mp, kg, usuarioId: actor.id, depositoId: ub.deposito, observaciones: `bolsón ${e.bolson}`, motivo: `Molienda entregada por el molino · bolsón ${e.bolson} (entrega #${e.id})${kg !== Number(e.kg) ? ` · pesada en MP: ${kg} kg (molino: ${e.kg} kg)` : ""}` });
      await tx.update(moliendaEntrega).set({ estado: "RECIBIDA", recibidoPorId: actor.id, recibidoEn: new Date(), movimientoId: r.movimientoId }).where(eq(moliendaEntrega.id, id));
      await registrarCambios(tx, actor.id, [
        { entidad: "molienda_entrega", entidadId: id, campo: "estado", anterior: "ENTREGADA", nuevo: "RECIBIDA", motivo: input.motivo },
        ...(kg !== Number(e.kg) ? [{ entidad: "molienda_entrega", entidadId: id, campo: "kg recibidos", anterior: e.kg, nuevo: kg, motivo: input.motivo }] : []),
      ]);
      return { codigo: r.codigo };
    });
  } catch (err) {
    if (err instanceof ErrorStock) return { error: err.message };
    throw err;
  }
}

/** Códigos de molienda (no sobrante) para elegir al entregar. */
export async function codigosMolienda() {
  return db.select({ id: materiaPrima.id, nombre: materiaPrima.nombre }).from(materiaPrima).where(and(eq(materiaPrima.tipo, "MOLIENDA"), eq(materiaPrima.activo, true))).orderBy(asc(materiaPrima.nombre));
}

/** Producciones recientes para vincular un descarte (opcional). */
export async function produccionesRecientes() {
  return db.select({ id: cicloProduccion.id, inyectora: cicloProduccion.inyectora, inicio: cicloProduccion.fechaInicio }).from(cicloProduccion).orderBy(desc(cicloProduccion.id)).limit(20);
}
