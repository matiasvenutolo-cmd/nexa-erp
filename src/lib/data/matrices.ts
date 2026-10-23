/**
 * Matrices (perfil de Alejandro Rivero): programación de cambios de matriz,
 * reparaciones y services, con su estado e historial. La planificación los
 * muestra para que el Encargado los tenga en cuenta. Qué turnos admiten
 * cambios de matriz está pendiente de definición: no se bloquea nada.
 */
import { and, asc, between, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { intervencionMatriz, producto, usuario } from "@/lib/db/schema";
import { puedeGestionarMatrices } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { INYECTORAS } from "@/lib/inyectoras";
import type { Turno } from "@/lib/turnos";

export type TipoIntervencion = (typeof intervencionMatriz.$inferSelect)["tipo"];
export type EstadoIntervencion = (typeof intervencionMatriz.$inferSelect)["estado"];
export const TIPO_INTERVENCION_LABEL: Record<TipoIntervencion, string> = { CAMBIO_MATRIZ: "Cambio de matriz", REPARACION: "Reparación", SERVICE: "Service programado" };
export const ESTADO_INTERVENCION_LABEL: Record<EstadoIntervencion, string> = { PROGRAMADA: "Programada", EN_CURSO: "En curso", REALIZADA: "Realizada", CANCELADA: "Cancelada" };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export type FilaIntervencion = typeof intervencionMatriz.$inferSelect & { responsableNombre: string | null; creadoPorNombre: string };

export async function listarIntervenciones(filtro: { desde?: string; hasta?: string; estados?: EstadoIntervencion[]; matriz?: string; limite?: number } = {}): Promise<FilaIntervencion[]> {
  const resp = alias(usuario, "responsable");
  const cond = [];
  if (filtro.desde && filtro.hasta) cond.push(between(intervencionMatriz.fechaProgramada, filtro.desde, filtro.hasta));
  if (filtro.estados?.length) cond.push(inArray(intervencionMatriz.estado, filtro.estados));
  if (filtro.matriz) cond.push(sql`lower(${intervencionMatriz.matriz}) = lower(${filtro.matriz})`);
  const filas = await db
    .select({ i: intervencionMatriz, responsableNombre: resp.nombre, creadoPorNombre: usuario.nombre })
    .from(intervencionMatriz)
    .leftJoin(resp, eq(intervencionMatriz.responsableId, resp.id))
    .innerJoin(usuario, eq(intervencionMatriz.creadoPorId, usuario.id))
    .where(cond.length ? and(...cond) : undefined)
    .orderBy(filtro.estados?.includes("REALIZADA") ? desc(intervencionMatriz.fechaProgramada) : asc(intervencionMatriz.fechaProgramada), asc(intervencionMatriz.id))
    .limit(filtro.limite ?? 200);
  return filas.map((f) => ({ ...f.i, responsableNombre: f.responsableNombre, creadoPorNombre: f.creadoPorNombre }));
}

/** Matrices conocidas (las que usan los productos), para sugerir al cargar. */
export async function matricesConocidas(): Promise<string[]> {
  const { matrizDe } = await import("@/lib/data/planificacion");
  const prods = await db.selectDistinct({ familia: producto.familia, tipo: producto.tipo }).from(producto).where(eq(producto.activo, true));
  const usadas = await db.selectDistinct({ m: intervencionMatriz.matriz }).from(intervencionMatriz);
  return [...new Set([...prods.map((p) => matrizDe(p)), ...usadas.map((u) => u.m)])].sort((a, b) => a.localeCompare(b));
}

export type NuevaIntervencionInput = {
  tipo: TipoIntervencion;
  matriz: string;
  matrizAnterior?: string | null;
  inyectora?: string | null;
  fechaProgramada: string;
  turno?: Turno | null;
  responsableId?: number | null;
  tandaId?: number | null;
  descripcion?: string | null;
};

export async function programarIntervencion(actor: Actor, input: NuevaIntervencionInput): Promise<Resultado & { id?: number }> {
  if (!puedeGestionarMatrices(actor.rol)) return { error: "No tenés permiso para programar trabajos de matrices." };
  if (!TIPO_INTERVENCION_LABEL[input.tipo]) return { error: "Tipo de trabajo inválido." };
  const matriz = input.matriz.trim();
  if (!matriz) return { error: "Indicá la matriz." };
  if (!FECHA.test(input.fechaProgramada)) return { error: "Indicá la fecha programada." };
  const iny = input.inyectora?.trim() || null;
  if (iny && !(INYECTORAS as readonly string[]).includes(iny)) return { error: "Inyectora inválida." };
  if (input.tipo === "CAMBIO_MATRIZ" && !iny) return { error: "Un cambio de matriz necesita la máquina." };
  return db.transaction(async (tx) => {
    const [i] = await tx
      .insert(intervencionMatriz)
      .values({
        tipo: input.tipo,
        matriz,
        matrizAnterior: input.matrizAnterior?.trim() || null,
        inyectora: iny,
        fechaProgramada: input.fechaProgramada,
        turno: input.turno ?? null,
        responsableId: input.responsableId ?? null,
        tandaId: input.tandaId ?? null,
        descripcion: input.descripcion?.trim() || null,
        creadoPorId: actor.id,
      })
      .returning();
    await registrarCambios(tx, actor.id, [
      { entidad: "intervencion_matriz", entidadId: i.id, campo: "alta", anterior: null, nuevo: `${TIPO_INTERVENCION_LABEL[i.tipo]} · ${matriz}${iny ? ` · iny. ${iny}` : ""} · ${input.fechaProgramada}` },
    ]);
    return { id: i.id };
  });
}

/** Avance del trabajo (en curso, realizada, cancelada) o reprogramación. */
export async function actualizarIntervencion(
  actor: Actor,
  id: number,
  cambios: { estado?: EstadoIntervencion; fechaProgramada?: string; turno?: Turno | null; responsableId?: number | null; observaciones?: string | null; motivo?: string | null },
): Promise<Resultado> {
  if (!puedeGestionarMatrices(actor.rol)) return { error: "No tenés permiso para modificar trabajos de matrices." };
  if (cambios.fechaProgramada && !FECHA.test(cambios.fechaProgramada)) return { error: "Fecha inválida." };
  if (cambios.estado === "CANCELADA" && !cambios.motivo?.trim()) return { error: "Indicá el motivo de la cancelación." };
  return db.transaction(async (tx) => {
    const [i] = await tx.select().from(intervencionMatriz).where(eq(intervencionMatriz.id, id)).for("update");
    if (!i) return { error: "Trabajo no encontrado." };
    if (i.estado === "REALIZADA" || i.estado === "CANCELADA") return { error: "Ese trabajo ya está cerrado: se conserva en el historial." };
    const estado = cambios.estado ?? i.estado;
    const ahora = new Date();
    const valores = {
      estado,
      fechaProgramada: cambios.fechaProgramada ?? i.fechaProgramada,
      turno: cambios.turno === undefined ? i.turno : cambios.turno,
      responsableId: cambios.responsableId === undefined ? i.responsableId : cambios.responsableId,
      observaciones: cambios.observaciones === undefined ? i.observaciones : cambios.observaciones?.trim() || null,
      iniciadaEn: estado === "EN_CURSO" && !i.iniciadaEn ? ahora : i.iniciadaEn,
      realizadaEn: estado === "REALIZADA" ? ahora : i.realizadaEn,
    };
    await tx.update(intervencionMatriz).set(valores).where(eq(intervencionMatriz.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "intervencion_matriz", entidadId: id, campo: "estado", anterior: ESTADO_INTERVENCION_LABEL[i.estado], nuevo: ESTADO_INTERVENCION_LABEL[estado], motivo: cambios.motivo },
      { entidad: "intervencion_matriz", entidadId: id, campo: "fecha_programada", anterior: i.fechaProgramada, nuevo: valores.fechaProgramada, motivo: cambios.motivo },
      { entidad: "intervencion_matriz", entidadId: id, campo: "turno", anterior: i.turno, nuevo: valores.turno, motivo: cambios.motivo },
      { entidad: "intervencion_matriz", entidadId: id, campo: "responsable_id", anterior: i.responsableId, nuevo: valores.responsableId, motivo: cambios.motivo },
      { entidad: "intervencion_matriz", entidadId: id, campo: "observaciones", anterior: i.observaciones, nuevo: valores.observaciones, motivo: cambios.motivo },
    ]);
    return {};
  });
}

/** Quién puede quedar como responsable: el perfil Matrices (principal o adicional) y quienes coordinan. */
export async function responsablesMatrices(): Promise<{ id: number; nombre: string }[]> {
  const filas = await db.select({ id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, adicionales: usuario.rolesAdicionales, activo: usuario.activo }).from(usuario).orderBy(asc(usuario.nombre));
  const roles = ["MATRICES", "ENCARGADO", "SUPERVISOR"];
  return filas.filter((u) => u.activo && (roles.includes(u.rol) || u.adicionales.some((r) => roles.includes(r)))).map((u) => ({ id: u.id, nombre: u.nombre }));
}
