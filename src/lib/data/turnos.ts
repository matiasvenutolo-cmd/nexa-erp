/**
 * Turnos de la planta (mejoras 22/10): el Encargado elige el esquema del día
 * (o de la semana) y asigna los operarios a cada turno al principio del día;
 * cada operario registra su relevo al cambiar de turno.
 */
import { asc, between, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { asignacionOperario, esquemaTurnoDia, usuario } from "@/lib/db/schema";
import { puedeAsignarTurnos } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { fechasParaTurno, turnosPosibles, type Esquema, type Turno, type TurnoPosible, VENTANAS } from "@/lib/turnos";

const ESQUEMAS: Esquema[] = ["SIMPLE", "DOBLE", "TRIPLE"];
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function esquemasEntre(desde: string, hasta: string): Promise<Map<string, Esquema>> {
  const filas = await db.select().from(esquemaTurnoDia).where(between(esquemaTurnoDia.fecha, desde, hasta));
  return new Map(filas.map((f) => [f.fecha, f.esquema]));
}

/** Esquema para varias fechas (un día o una semana entera). */
export async function guardarEsquema(actor: Actor, fechas: string[], esquema: Esquema | null): Promise<Resultado> {
  if (!puedeAsignarTurnos(actor.rol)) return { error: "No tenés permiso para configurar los turnos." };
  const validas = [...new Set(fechas.filter((f) => FECHA.test(f)))];
  if (validas.length === 0) return { error: "Elegí al menos un día." };
  if (esquema && !ESQUEMAS.includes(esquema)) return { error: "Esquema inválido." };
  await db.transaction(async (tx) => {
    const antes = await tx.select().from(esquemaTurnoDia).where(inArray(esquemaTurnoDia.fecha, validas));
    for (const f of validas) {
      if (esquema) {
        await tx
          .insert(esquemaTurnoDia)
          .values({ fecha: f, esquema, actualizadoPorId: actor.id })
          .onConflictDoUpdate({ target: esquemaTurnoDia.fecha, set: { esquema, actualizadoPorId: actor.id, actualizadoEn: new Date() } });
      } else {
        await tx.delete(esquemaTurnoDia).where(eq(esquemaTurnoDia.fecha, f));
      }
    }
    await registrarCambios(
      tx,
      actor.id,
      validas.map((f) => ({ entidad: "esquema_turno", entidadId: f, campo: "esquema", anterior: antes.find((a) => a.fecha === f)?.esquema ?? null, nuevo: esquema })),
    );
  });
  return {};
}

export type Asignacion = { id: number; fecha: string; turno: Turno; usuarioId: number; usuarioNombre: string; inyectora: string | null };

export async function asignacionesEntre(desde: string, hasta: string): Promise<Asignacion[]> {
  return db
    .select({ id: asignacionOperario.id, fecha: asignacionOperario.fecha, turno: asignacionOperario.turno, usuarioId: asignacionOperario.usuarioId, usuarioNombre: usuario.nombre, inyectora: asignacionOperario.inyectora })
    .from(asignacionOperario)
    .innerJoin(usuario, eq(asignacionOperario.usuarioId, usuario.id))
    .where(between(asignacionOperario.fecha, desde, hasta))
    .orderBy(asc(asignacionOperario.fecha), asc(asignacionOperario.turno), asc(usuario.nombre));
}

export async function asignarOperario(actor: Actor, input: { fecha: string; turno: Turno; usuarioId: number; inyectora?: string | null }): Promise<Resultado> {
  if (!puedeAsignarTurnos(actor.rol)) return { error: "No tenés permiso para asignar operarios." };
  if (!FECHA.test(input.fecha)) return { error: "Fecha inválida." };
  if (!["MANANA", "TARDE", "NOCHE"].includes(input.turno)) return { error: "Turno inválido." };
  const [u] = await db.select().from(usuario).where(eq(usuario.id, input.usuarioId));
  if (!u || !u.activo) return { error: "Operario no encontrado o dado de baja." };
  if (u.rol !== "OPERARIO" && !u.rolesAdicionales.includes("OPERARIO")) return { error: `${u.nombre} no tiene el perfil Operario.` };
  const [esq] = await db.select().from(esquemaTurnoDia).where(eq(esquemaTurnoDia.fecha, input.fecha));
  if (esq && !VENTANAS[esq.esquema].some((v) => v.turno === input.turno)) {
    return { error: `Ese día el esquema es ${esq.esquema.toLowerCase()}: no tiene ese turno.` };
  }
  const iny = input.inyectora?.trim() || null;
  await db.transaction(async (tx) => {
    const [fila] = await tx
      .insert(asignacionOperario)
      .values({ fecha: input.fecha, turno: input.turno, usuarioId: u.id, inyectora: iny, creadoPorId: actor.id })
      .onConflictDoUpdate({ target: [asignacionOperario.fecha, asignacionOperario.turno, asignacionOperario.usuarioId], set: { inyectora: iny } })
      .returning();
    await registrarCambios(tx, actor.id, [
      { entidad: "asignacion_operario", entidadId: fila.id, campo: "asignación", anterior: null, nuevo: `${u.nombre} · ${input.fecha} · ${input.turno}${iny ? ` · iny. ${iny}` : ""}` },
    ]);
  });
  return {};
}

export async function quitarAsignacion(actor: Actor, id: number): Promise<Resultado> {
  if (!puedeAsignarTurnos(actor.rol)) return { error: "No tenés permiso para asignar operarios." };
  const [a] = await db.select().from(asignacionOperario).where(eq(asignacionOperario.id, id));
  if (!a) return { error: "Asignación no encontrada." };
  await db.transaction(async (tx) => {
    await tx.delete(asignacionOperario).where(eq(asignacionOperario.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "asignacion_operario", entidadId: id, campo: "asignación", anterior: `usuario ${a.usuarioId} · ${a.fecha} · ${a.turno}`, nuevo: null },
    ]);
  });
  return {};
}

export type OpcionesTurno = {
  /** Turnos activos ahora (0, 1 o 2 por superposición). */
  posibles: TurnoPosible[];
  /** El único posible, o el que tiene asignado el operario entre los posibles. */
  sugerido: TurnoPosible | null;
  /** Si hay que preguntarle (superposición sin asignación, o sin esquema). */
  preguntar: boolean;
  /** Turnos para elegir cuando hay que preguntar. */
  opciones: Turno[];
  sinEsquema: boolean;
  asignado: Asignacion | null;
};

/** Qué turno es para este operario en este momento. */
export async function opcionesTurno(usuarioId: number | null, ahora = new Date()): Promise<OpcionesTurno> {
  const { hoy, ayer } = fechasParaTurno(ahora);
  const esquemas = await esquemasEntre(ayer, hoy);
  const posibles = turnosPosibles(ahora, (f) => esquemas.get(f) ?? null);
  const asignaciones = usuarioId ? (await asignacionesEntre(ayer, hoy)).filter((a) => a.usuarioId === usuarioId) : [];
  const asignado = asignaciones.find((a) => posibles.some((p) => p.fecha === a.fecha && p.turno === a.turno)) ?? null;
  const sinEsquema = !esquemas.get(hoy) && posibles.length === 0;
  const sugerido = posibles.length === 1 ? posibles[0] : asignado ? (posibles.find((p) => p.fecha === asignado.fecha && p.turno === asignado.turno) ?? null) : null;
  const preguntar = !sugerido;
  const opciones: Turno[] = posibles.length > 1 ? posibles.map((p) => p.turno) : (esquemas.get(hoy) ? VENTANAS[esquemas.get(hoy)!].map((v) => v.turno) : ["MANANA", "TARDE", "NOCHE"]);
  return { posibles, sugerido, preguntar, opciones, sinEsquema, asignado };
}

/** Operarios activos (perfil principal o adicional) para asignar. */
export async function operariosActivos(): Promise<{ id: number; nombre: string }[]> {
  const filas = await db.select({ id: usuario.id, nombre: usuario.nombre, rol: usuario.rol, adicionales: usuario.rolesAdicionales, activo: usuario.activo }).from(usuario).orderBy(asc(usuario.nombre));
  return filas.filter((u) => u.activo && (u.rol === "OPERARIO" || u.adicionales.includes("OPERARIO"))).map((u) => ({ id: u.id, nombre: u.nombre }));
}

