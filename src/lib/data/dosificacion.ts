/**
 * Dosificación de master (tabla `dosificacion_master`).
 *
 * Minuta del 22/10/2026 (vigente): rejilla 15 g de master por kg de 2240P;
 * ciego 15 g por cada 0,5 kg de mezcla 2630PC + Plastomer (= 30 g/kg), con la
 * proporción entre ambos pendiente. Lo de abajo es la definición anterior, que
 * estaba cargada en una unidad equivocada (0,015 «g/kg» = 15 g/kg).
 *
 * Definiciones pendientes, respuesta 2: piso rejilla 0,015 g/kg sobre el
 * Copolímero 2240P, rejilla negro 0,012 g/kg "por ser un color muy intenso",
 * piso ciego 0,018 g/kg sobre el Copolímero 2630PC, "pudiendo variar según color". Por eso la
 * estructura es familia + color opcional: una fila sin color es el valor base
 * de la familia; una fila con color es la excepción. Los valores iniciales
 * los carga scripts/cargar-configuracion.ts; acá no hay ninguno.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { color, dosificacionMaster, materiaPrima, producto, usuario } from "@/lib/db/schema";
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
  materiaPrimaBase2Id: number | null;
  materiaPrimaBase2Nombre: string | null;
  /** Fracción del material base 1 en la mezcla; null = pendiente (o no hay mezcla). */
  proporcionBase1: number | null;
  gPorKgMp: number;
  /** «g de master cada `kgReferencia` kg» como lo dijo el cliente. */
  kgReferencia: number;
  gPorReferencia: number;
  observaciones: string | null;
  actualizadoEn: Date;
  actualizadoPorNombre: string | null;
};

export async function listarDosificaciones(): Promise<FilaDosificacion[]> {
  const base2 = alias(materiaPrima, "mp_base2");
  const filas = await db
    .select({
      id: dosificacionMaster.id,
      familia: dosificacionMaster.familia,
      colorId: dosificacionMaster.colorId,
      colorNombre: color.nombre,
      materiaPrimaBaseId: dosificacionMaster.materiaPrimaBaseId,
      materiaPrimaBaseNombre: materiaPrima.nombre,
      materiaPrimaBase2Id: dosificacionMaster.materiaPrimaBase2Id,
      materiaPrimaBase2Nombre: base2.nombre,
      proporcionBase1: dosificacionMaster.proporcionBase1,
      gPorKgMp: dosificacionMaster.gPorKgMp,
      kgReferencia: dosificacionMaster.kgReferencia,
      observaciones: dosificacionMaster.observaciones,
      actualizadoEn: dosificacionMaster.actualizadoEn,
      actualizadoPorNombre: usuario.nombre,
    })
    .from(dosificacionMaster)
    .leftJoin(color, eq(dosificacionMaster.colorId, color.id))
    .leftJoin(materiaPrima, eq(dosificacionMaster.materiaPrimaBaseId, materiaPrima.id))
    .leftJoin(base2, eq(dosificacionMaster.materiaPrimaBase2Id, base2.id))
    .leftJoin(usuario, eq(dosificacionMaster.actualizadoPorId, usuario.id))
    .orderBy(asc(dosificacionMaster.familia), sql`${dosificacionMaster.colorId} nulls first`, asc(color.nombre));
  return filas.map((f) => {
    const g = Number(f.gPorKgMp);
    const ref = Number(f.kgReferencia) || 1;
    return { ...f, gPorKgMp: g, kgReferencia: ref, gPorReferencia: Math.round(g * ref * 1000) / 1000, proporcionBase1: f.proporcionBase1 == null ? null : Number(f.proporcionBase1) };
  });
}

export type Dosificacion = {
  gPorKgMp: number;
  kgReferencia: number;
  origen: "excepcion" | "base";
  colorNombre: string | null;
  materiaPrimaBaseId: number | null;
  materiaPrimaBaseNombre: string | null;
  materiaPrimaBase2Id: number | null;
  materiaPrimaBase2Nombre: string | null;
  proporcionBase1: number | null;
};

/** Excepción del color si existe; si no, el valor base de la familia; si no, null. */
export async function resolverDosificacion(familia: Familia, colorId: number | null): Promise<Dosificacion | null> {
  const base = alias(materiaPrima, "mp_base");
  const base2 = alias(materiaPrima, "mp_base2");
  const filas = await db
    .select({
      colorId: dosificacionMaster.colorId,
      gPorKgMp: dosificacionMaster.gPorKgMp,
      kgReferencia: dosificacionMaster.kgReferencia,
      colorNombre: color.nombre,
      materiaPrimaBaseId: dosificacionMaster.materiaPrimaBaseId,
      materiaPrimaBaseNombre: base.nombre,
      materiaPrimaBase2Id: dosificacionMaster.materiaPrimaBase2Id,
      materiaPrimaBase2Nombre: base2.nombre,
      proporcionBase1: dosificacionMaster.proporcionBase1,
    })
    .from(dosificacionMaster)
    .leftJoin(color, eq(dosificacionMaster.colorId, color.id))
    .leftJoin(base, eq(dosificacionMaster.materiaPrimaBaseId, base.id))
    .leftJoin(base2, eq(dosificacionMaster.materiaPrimaBase2Id, base2.id))
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
    gPorKgMp: Number(fila.gPorKgMp),
    kgReferencia: Number(fila.kgReferencia) || 1,
    origen: fila.colorId != null ? "excepcion" : "base",
    colorNombre: fila.colorNombre,
    materiaPrimaBaseId: fila.materiaPrimaBaseId,
    materiaPrimaBaseNombre: fila.materiaPrimaBaseNombre,
    materiaPrimaBase2Id: fila.materiaPrimaBase2Id,
    materiaPrimaBase2Nombre: fila.materiaPrimaBase2Nombre,
    proporcionBase1: fila.proporcionBase1 == null ? null : Number(fila.proporcionBase1),
  };
}

export type DosificacionInput = {
  familia: Familia;
  colorId: number | null;
  materiaPrimaBaseId: number | null;
  gPorKgMp: number;
  kgReferencia?: number;
  materiaPrimaBase2Id?: number | null;
  proporcionBase1?: number | null;
  observaciones?: string | null;
  motivo?: string | null;
};

function validar(input: DosificacionInput): string | null {
  if (!Number.isFinite(input.gPorKgMp) || input.gPorKgMp <= 0) {
    return "La dosificación tiene que ser un número mayor que 0 (gramos de master por kg de materia prima).";
  }
  if (input.familia !== "REJILLA" && input.familia !== "CIEGO") return "Familia inválida.";
  if (input.kgReferencia != null && (!Number.isFinite(input.kgReferencia) || input.kgReferencia <= 0)) return "La cantidad de referencia (kg) tiene que ser mayor que 0.";
  if (input.proporcionBase1 != null && (!Number.isFinite(input.proporcionBase1) || input.proporcionBase1 <= 0 || input.proporcionBase1 >= 1)) {
    return "La proporción del primer material tiene que estar entre 0 y 100 % (sin incluir los extremos), o quedar vacía si está pendiente.";
  }
  if (input.proporcionBase1 != null && !input.materiaPrimaBase2Id) return "Sin segundo material no hay proporción para definir.";
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
        gPorKgMp: String(input.gPorKgMp),
        kgReferencia: String(input.kgReferencia ?? 1),
        materiaPrimaBase2Id: input.materiaPrimaBase2Id ?? null,
        proporcionBase1: input.proporcionBase1 == null ? null : String(input.proporcionBase1),
        observaciones: input.observaciones?.trim() || null,
        actualizadoPorId: actor.id,
      })
      .returning();
    await registrarCambios(tx, actor.id, [
      { entidad: "dosificacion_master", entidadId: nueva.id, campo: "g_por_kg_mp", anterior: null, nuevo: input.gPorKgMp, motivo: input.motivo },
    ]);
    return {};
  });
}

export async function actualizarDosificacion(
  actor: Actor,
  id: number,
  cambios: { gPorKgMp: number; kgReferencia?: number; materiaPrimaBaseId: number | null; materiaPrimaBase2Id?: number | null; proporcionBase1?: number | null; observaciones?: string | null; motivo?: string | null },
): Promise<Resultado> {
  if (!puedeEditarParametrosProduccion(actor.rol)) return { error: "No tenés permiso para cambiar la dosificación de master." };

  return db.transaction(async (tx) => {
    const [actual] = await tx.select().from(dosificacionMaster).where(eq(dosificacionMaster.id, id));
    if (!actual) return { error: "Dosificación no encontrada." };
    const error = validar({ ...actual, colorId: actual.colorId, ...cambios, gPorKgMp: cambios.gPorKgMp, kgReferencia: cambios.kgReferencia, proporcionBase1: cambios.proporcionBase1 });
    if (error) return { error };

    const observaciones = cambios.observaciones?.trim() || null;
    await tx
      .update(dosificacionMaster)
      .set({
        gPorKgMp: String(cambios.gPorKgMp),
        kgReferencia: String(cambios.kgReferencia ?? actual.kgReferencia),
        materiaPrimaBaseId: cambios.materiaPrimaBaseId,
        materiaPrimaBase2Id: cambios.materiaPrimaBase2Id === undefined ? actual.materiaPrimaBase2Id : cambios.materiaPrimaBase2Id,
        proporcionBase1: cambios.proporcionBase1 === undefined ? actual.proporcionBase1 : cambios.proporcionBase1 == null ? null : String(cambios.proporcionBase1),
        observaciones,
        actualizadoEn: new Date(),
        actualizadoPorId: actor.id,
      })
      .where(eq(dosificacionMaster.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "dosificacion_master", entidadId: id, campo: "g_por_kg_mp", anterior: actual.gPorKgMp, nuevo: cambios.gPorKgMp, motivo: cambios.motivo },
      { entidad: "dosificacion_master", entidadId: id, campo: "materia_prima_base_id", anterior: actual.materiaPrimaBaseId, nuevo: cambios.materiaPrimaBaseId, motivo: cambios.motivo },
      { entidad: "dosificacion_master", entidadId: id, campo: "kg_referencia", anterior: actual.kgReferencia, nuevo: cambios.kgReferencia ?? actual.kgReferencia, motivo: cambios.motivo },
      ...(cambios.materiaPrimaBase2Id === undefined ? [] : [{ entidad: "dosificacion_master", entidadId: id, campo: "materia_prima_base2_id", anterior: actual.materiaPrimaBase2Id, nuevo: cambios.materiaPrimaBase2Id, motivo: cambios.motivo }]),
      ...(cambios.proporcionBase1 === undefined ? [] : [{ entidad: "dosificacion_master", entidadId: id, campo: "proporcion_base1", anterior: actual.proporcionBase1, nuevo: cambios.proporcionBase1, motivo: cambios.motivo }]),
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
      { entidad: "dosificacion_master", entidadId: id, campo: "g_por_kg_mp (excepción quitada)", anterior: actual.gPorKgMp, nuevo: null, motivo },
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

export type ComparacionReceta = {
  productoId: number;
  codigo: string;
  descripcion: string;
  kgBase: number;
  kgMasterReceta: number;
  gPorKgReceta: number | null;
  /** Lo que da la dosificación vigente; null si no hay dosificación. */
  kgMasterDosificacion: number | null;
  gPorKgDosificacion: number | null;
  sugerenciaMaster: string | null;
  proporcionPendiente: boolean;
};

/**
 * Impacto de la dosificación vigente sobre las recetas de carga activas:
 * cuánto master llevan hoy y cuánto correspondería. No modifica nada (las
 * recetas las ajusta el Encargado; las producciones cerradas no se tocan).
 */
export async function compararRecetasConDosificacion(): Promise<ComparacionReceta[]> {
  const { productosConReceta, listarPresentaciones } = await import("@/lib/data/recetas");
  const { masterParaBase, enBolsas } = await import("@/lib/presentaciones");
  const [productos, presentaciones, filas] = await Promise.all([productosConReceta(), listarPresentaciones(), db.select({ id: producto.id, colorId: producto.colorId }).from(producto)]);
  const presMaster = presentaciones.filter((p) => p.tipoMp === "MASTER").map((p) => ({ nombre: p.nombre, kg: p.kg }));
  const out: ComparacionReceta[] = [];
  for (const p of productos) {
    const r = p.recetas.REGIMEN;
    if (!r) continue;
    const colorId = filas.find((f) => f.id === p.id)?.colorId ?? null;
    const d = await resolverDosificacion(p.familia, colorId);
    const esperado = d ? masterParaBase(r.kgVirgen, d.gPorKgMp) : null;
    out.push({
      productoId: p.id,
      codigo: p.codigo,
      descripcion: p.descripcion,
      kgBase: r.kgVirgen,
      kgMasterReceta: r.kgMaster,
      gPorKgReceta: r.gMasterPorKg,
      kgMasterDosificacion: esperado,
      gPorKgDosificacion: d?.gPorKgMp ?? null,
      sugerenciaMaster: esperado != null ? enBolsas(esperado, presMaster) : null,
      proporcionPendiente: Boolean(d?.materiaPrimaBase2Id && d.proporcionBase1 == null),
    });
  }
  return out;
}
