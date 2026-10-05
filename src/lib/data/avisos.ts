/**
 * Avisos internos dirigidos a un rol. Es el único mecanismo de aviso del
 * sistema: lo usan el aviso a ventas (pedido listo para despachar), el
 * reclamo nuevo al supervisor y el informe de un reclamo a gerencia. Cada
 * aviso queda asociado a su pedido/reclamo, con quién lo generó, quién lo vio
 * y quién lo procesó.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { aviso, cliente, pedido, usuario } from "@/lib/db/schema";
import type { Actor, Resultado, Rol } from "@/lib/data/auditoria";

type Ejecutor = Pick<typeof db, "insert">;

export async function crearAviso(
  ex: Ejecutor,
  input: {
    tipo: (typeof aviso.$inferInsert)["tipo"];
    destinoRol: Rol;
    mensaje: string;
    pedidoId?: number | null;
    despachoId?: number | null;
    reclamoId?: number | null;
    creadoPorId: number;
  },
) {
  await ex.insert(aviso).values(input);
}

/** Gerencia ve todos los avisos; el resto, los de su rol. */
function condicionRol(rol: Rol) {
  return rol === "GERENCIA" ? undefined : eq(aviso.destinoRol, rol);
}

export async function contarAvisosPendientes(rol: Rol): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(aviso)
    .where(and(condicionRol(rol), isNull(aviso.procesadoEn)));
  return n;
}

const creador = alias(usuario, "aviso_creador");
const visto = alias(usuario, "aviso_visto");
const procesado = alias(usuario, "aviso_procesado");

export async function listarAvisos(rol: Rol, opciones?: { incluirProcesados?: boolean; limite?: number }) {
  return db
    .select({
      id: aviso.id,
      tipo: aviso.tipo,
      destinoRol: aviso.destinoRol,
      mensaje: aviso.mensaje,
      pedidoId: aviso.pedidoId,
      reclamoId: aviso.reclamoId,
      clienteNombre: cliente.nombre,
      creadoEn: aviso.creadoEn,
      creadoPorNombre: creador.nombre,
      vistoEn: aviso.vistoEn,
      vistoPorNombre: visto.nombre,
      procesadoEn: aviso.procesadoEn,
      procesadoPorNombre: procesado.nombre,
    })
    .from(aviso)
    .innerJoin(creador, eq(aviso.creadoPorId, creador.id))
    .leftJoin(visto, eq(aviso.vistoPorId, visto.id))
    .leftJoin(procesado, eq(aviso.procesadoPorId, procesado.id))
    .leftJoin(pedido, eq(aviso.pedidoId, pedido.id))
    .leftJoin(cliente, eq(pedido.clienteId, cliente.id))
    .where(and(condicionRol(rol), opciones?.incluirProcesados ? undefined : isNull(aviso.procesadoEn)))
    .orderBy(desc(aviso.creadoEn), desc(aviso.id))
    .limit(opciones?.limite ?? 200);
}

async function avisoDelActor(actor: Actor, id: number) {
  const [a] = await db.select().from(aviso).where(eq(aviso.id, id));
  if (!a) return null;
  if (actor.rol !== "GERENCIA" && a.destinoRol !== actor.rol) return null;
  return a;
}

export async function marcarAvisoVisto(actor: Actor, id: number): Promise<Resultado> {
  const a = await avisoDelActor(actor, id);
  if (!a) return { error: "Aviso no encontrado." };
  if (!a.vistoEn) await db.update(aviso).set({ vistoEn: new Date(), vistoPorId: actor.id }).where(eq(aviso.id, id));
  return {};
}

export async function marcarAvisoProcesado(actor: Actor, id: number): Promise<Resultado> {
  const a = await avisoDelActor(actor, id);
  if (!a) return { error: "Aviso no encontrado." };
  if (a.procesadoEn) return {};
  await db
    .update(aviso)
    .set({
      procesadoEn: new Date(),
      procesadoPorId: actor.id,
      ...(a.vistoEn ? {} : { vistoEn: new Date(), vistoPorId: actor.id }),
    })
    .where(eq(aviso.id, id));
  return {};
}
