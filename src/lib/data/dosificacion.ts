/**
 * Dosificación de master (tabla `dosificacion_master`).
 *
 * Definiciones pendientes, respuesta 2: piso rejilla 0,015 sobre el Copolímero
 * 2240P, rejilla negro 0,012 "por ser un color muy intenso", piso ciego 0,018
 * sobre el Copolímero 2630PC, "pudiendo variar según color". Por eso la
 * estructura es familia + color opcional: una fila sin color es el valor base
 * de la familia; una fila con color es la excepción. Los valores iniciales
 * los carga scripts/cargar-configuracion.ts; acá no hay ninguno.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { color, dosificacionMaster, materiaPrima, usuario } from "@/lib/db/schema";
import { puedeEditarParametrosProduccion } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";

type Familia = (typeof dosificacionMaster.$inferSelect)["familia"];

export type FilaDosificacion = {
  id: number;
  familia: Familia;
  colorId: number | null;
  colorNombre: string | null;
  materiaPrimaBaseId: number | null;
  materiaPrimaBaseNombre: string | null;
  kgPorKgMp: number;
  observaciones: string | null;
  actualizadoEn: Date;
  actualizadoPorNombre: string | null;
};

export async function listarDosificaciones(): Promise<FilaDosificacion[]> {
  const filas = await db
    .select({
      id: dosificacionMaster.id,
      familia: dosificacionMaster.familia,
      colorId: dosificacionMaster.colorId,
      colorNombre: color.nombre,
      materiaPrimaBaseId: dosificacionMaster.materiaPrimaBaseId,
      materiaPrimaBaseNombre: materiaPrima.nombre,
      kgPorKgMp: dosificacionMaster.kgPorKgMp,
      observaciones: dosificacionMaster.observaciones,
      actualizadoEn: dosificacionMaster.actualizadoEn,
      actualizadoPorNombre: usuario.nombre,
    })
    .from(dosificacionMaster)
    .leftJoin(color, eq(dosificacionMaster.colorId, color.id))
    .leftJoin(materiaPrima, eq(dosificacionMaster.materiaPrimaBaseId, materiaPrima.id))
    .leftJoin(usuario, eq(dosificacionMaster.actualizadoPorId, usuario.id))
    .orderBy(asc(dosificacionMaster.familia), sql`${dosificacionMaster.colorId} nulls first`, asc(color.nombre));
  return filas.map((f) => ({ ...f, kgPorKgMp: Number(f.kgPorKgMp) }));
}

export type Dosificacion = {
  kgPorKgMp: number;
  origen: "excepcion" | "base";
  colorNombre: string | null;
  materiaPrimaBaseNombre: string | null;
};

/** Excepción del color si existe; si no, el valor base de la familia; si no, null. */
export async function resolverDosificacion(familia: Familia, colorId: number | null): Promise<Dosificacion | null> {
  const base = alias(materiaPrima, "mp_base");
  const filas = await db
    .select({
      colorId: dosificacionMaster.colorId,
      kgPorKgMp: dosificacionMaster.kgPorKgMp,
      colorNombre: color.nombre,
      materiaPrimaBaseNombre: base.nombre,
    })
    .from(dosificacionMaster)
    .leftJoin(color, eq(dosificacionMaster.colorId, color.id))
    .leftJoin(base, eq(dosificacionMaster.materiaPrimaBaseId, base.id))
    .where(
      and(
        eq(dosificacionMaster.familia, familia),
        colorId != null
          ? sql`(${dosificacionMaster.colorId} = ${colorId} or ${dosificacionMaster.colorId} is null)`
          : isNull(dosificacionMaster.colorId),
      ),
    );
  const fila = filas.find((f) => f.colorId != null) ?? filas.find((f) => f.colorId == null);
  if (!fila) return null;
  return {
    kgPorKgMp: Number(fila.kgPorKgMp),
    origen: fila.colorId != null ? "excepcion" : "base",
    colorNombre: fila.colorNombre,
    materiaPrimaBaseNombre: fila.materiaPrimaBaseNombre,
  };
}

export type DosificacionInput = {
  familia: Familia;
  colorId: number | null;
  materiaPrimaBaseId: number | null;
  kgPorKgMp: number;
  observaciones?: string | null;
  motivo?: string | null;
};

function validar(input: DosificacionInput): string | null {
  // kg de master por kg de materia prima: tiene que ser una fracción (no puede
  // llevar más master que materia prima).
  if (!Number.isFinite(input.kgPorKgMp) || input.kgPorKgMp <= 0 || input.kgPorKgMp >= 1) {
    return "La dosificación tiene que ser mayor que 0 y menor que 1 (kg de master por kg de materia prima).";
  }
  if (input.familia !== "REJILLA" && input.familia !== "CIEGO") return "Familia inválida.";
  return null;
}

/** Alta de una dosificación (base de familia o excepción por color). */
export async function crearDosificacion(actor: Actor, input: DosificacionInput): Promise<Resultado> {
  if (!puedeEditarParametrosProduccion(actor.rol)) return { error: "No tenés permiso para cambiar la dosificación de master." };
  const error = validar(input);
  if (error) return { error };

  return db.transaction(async (tx) => {
    const [ya] = await tx
      .select({ id: dosificacionMaster.id })
      .from(dosificacionMaster)
      .where(
        and(
          eq(dosificacionMaster.familia, input.familia),
          input.colorId == null ? isNull(dosificacionMaster.colorId) : eq(dosificacionMaster.colorId, input.colorId),
        ),
      );
    if (ya) return { error: "Ya existe una dosificación para esa familia y color: editala en la tabla." };

    const [nueva] = await tx
      .insert(dosificacionMaster)
      .values({
        familia: input.familia,
        colorId: input.colorId,
        materiaPrimaBaseId: input.materiaPrimaBaseId,
        kgPorKgMp: String(input.kgPorKgMp),
        observaciones: input.observaciones?.trim() || null,
        actualizadoPorId: actor.id,
      })
      .returning();
    await registrarCambios(tx, actor.id, [
      { entidad: "dosificacion_master", entidadId: nueva.id, campo: "kg_por_kg_mp", anterior: null, nuevo: input.kgPorKgMp, motivo: input.motivo },
    ]);
    return {};
  });
}

export async function actualizarDosificacion(
  actor: Actor,
  id: number,
  cambios: { kgPorKgMp: number; materiaPrimaBaseId: number | null; observaciones?: string | null; motivo?: string | null },
): Promise<Resultado> {
  if (!puedeEditarParametrosProduccion(actor.rol)) return { error: "No tenés permiso para cambiar la dosificación de master." };

  return db.transaction(async (tx) => {
    const [actual] = await tx.select().from(dosificacionMaster).where(eq(dosificacionMaster.id, id));
    if (!actual) return { error: "Dosificación no encontrada." };
    const error = validar({ ...actual, colorId: actual.colorId, ...cambios });
    if (error) return { error };

    const observaciones = cambios.observaciones?.trim() || null;
    await tx
      .update(dosificacionMaster)
      .set({
        kgPorKgMp: String(cambios.kgPorKgMp),
        materiaPrimaBaseId: cambios.materiaPrimaBaseId,
        observaciones,
        actualizadoEn: new Date(),
        actualizadoPorId: actor.id,
      })
      .where(eq(dosificacionMaster.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "dosificacion_master", entidadId: id, campo: "kg_por_kg_mp", anterior: actual.kgPorKgMp, nuevo: cambios.kgPorKgMp, motivo: cambios.motivo },
      { entidad: "dosificacion_master", entidadId: id, campo: "materia_prima_base_id", anterior: actual.materiaPrimaBaseId, nuevo: cambios.materiaPrimaBaseId, motivo: cambios.motivo },
      { entidad: "dosificacion_master", entidadId: id, campo: "observaciones", anterior: actual.observaciones, nuevo: observaciones, motivo: cambios.motivo },
    ]);
    return {};
  });
}

/** Sólo las excepciones por color se pueden quitar; el valor base de la
 *  familia se edita, no se borra (sin él no hay de dónde resolver). */
export async function eliminarExcepcionDosificacion(actor: Actor, id: number, motivo?: string | null): Promise<Resultado> {
  if (!puedeEditarParametrosProduccion(actor.rol)) return { error: "No tenés permiso para cambiar la dosificación de master." };

  return db.transaction(async (tx) => {
    const [actual] = await tx.select().from(dosificacionMaster).where(eq(dosificacionMaster.id, id));
    if (!actual) return { error: "Dosificación no encontrada." };
    if (actual.colorId == null) return { error: "El valor base de la familia no se puede quitar, sólo editar." };
    await tx.delete(dosificacionMaster).where(eq(dosificacionMaster.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "dosificacion_master", entidadId: id, campo: "kg_por_kg_mp (excepción quitada)", anterior: actual.kgPorKgMp, nuevo: null, motivo },
    ]);
    return {};
  });
}

/** Opciones para el formulario: colores y materias primas base (vírgenes). */
export async function opcionesDosificacion() {
  const [colores, materias] = await Promise.all([
    db.select({ id: color.id, nombre: color.nombre }).from(color).orderBy(asc(color.nombre)),
    db
      .select({ id: materiaPrima.id, nombre: materiaPrima.nombre })
      .from(materiaPrima)
      .where(eq(materiaPrima.tipo, "VIRGEN"))
      .orderBy(asc(materiaPrima.id)),
  ]);
  return { colores, materias };
}
