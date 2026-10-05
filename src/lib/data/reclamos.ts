/**
 * Reclamos de clientes (Definiciones pendientes): "las vendedoras tienen que
 * buscar el pedido y detallar qué pasó, este reclamo pasa sí o sí por el
 * supervisor para que evalúe cómo solucionarlo y detalle en el historial la
 * causa y la solución, con opción de enviar el informe a gerencia".
 *
 * Cada paso queda en `reclamo_evento`. El aviso al supervisor y el informe a
 * gerencia usan el mismo mecanismo de avisos del sistema.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import { caja, cliente, despacho, pedido, reclamo, reclamoEvento, usuario } from "@/lib/db/schema";
import { puedeCrearReclamo, puedeResolverReclamo } from "@/lib/auth/permisos";
import { crearAviso } from "@/lib/data/avisos";
import type { Actor, Resultado } from "@/lib/data/auditoria";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type MotivoDevolucion = NonNullable<(typeof reclamo.$inferInsert)["motivoDevolucion"]>;
export type EstadoReclamo = (typeof reclamo.$inferSelect)["estado"];

export const MOTIVO_DEVOLUCION_LABEL: Record<MotivoDevolucion, string> = {
  DIRECCION_ERRONEA: "Dirección errónea",
  MERCADERIA_ERRONEA: "Mercadería errónea",
  MERCADERIA_FALLADA: "Mercadería fallada",
  MATERIAL_DEFECTUOSO: "Material defectuoso",
};

export const ESTADO_RECLAMO_LABEL: Record<EstadoReclamo, string> = {
  ABIERTO: "Abierto — esperando al supervisor",
  EN_ANALISIS: "En análisis del supervisor",
  CERRADO: "Cerrado",
};

async function evento(tx: Tx, reclamoId: number, tipo: string, detalle: string | null, usuarioId: number) {
  await tx.insert(reclamoEvento).values({ reclamoId, tipo, detalle, usuarioId });
}

export async function crearReclamo(
  actor: Actor,
  input: { pedidoId: number; descripcion: string; motivoDevolucion?: MotivoDevolucion | null; cajaCodigo?: string | null },
): Promise<Resultado & { id?: number }> {
  if (!puedeCrearReclamo(actor.rol)) return { error: "No tenés permiso para registrar reclamos." };
  const descripcion = input.descripcion.trim();
  if (!descripcion) return { error: "Detallá qué pasó." };
  return db.transaction(async (tx) => {
    const [p] = await tx
      .select({ id: pedido.id, cliente: cliente.nombre })
      .from(pedido)
      .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
      .where(eq(pedido.id, input.pedidoId));
    if (!p) return { error: "Pedido no encontrado." };

    let cajaId: number | null = null;
    let partidaId: number | null = null;
    let despachoId: number | null = null;
    if (input.cajaCodigo?.trim()) {
      const [c] = await tx.select().from(caja).where(eq(caja.codigoBarra, input.cajaCodigo.trim().toUpperCase()));
      if (!c) return { error: `No existe la caja ${input.cajaCodigo.trim()}.` };
      cajaId = c.id;
      partidaId = c.partidaId;
    }
    const [ultimoDespacho] = await tx
      .select({ id: despacho.id })
      .from(despacho)
      .where(and(eq(despacho.pedidoId, input.pedidoId), eq(despacho.estado, "ENTREGADO")))
      .orderBy(desc(despacho.id))
      .limit(1);
    despachoId = ultimoDespacho?.id ?? null;

    const [r] = await tx
      .insert(reclamo)
      .values({
        pedidoId: input.pedidoId,
        despachoId,
        cajaId,
        partidaId,
        descripcion,
        motivoDevolucion: input.motivoDevolucion ?? null,
        creadoPorId: actor.id,
      })
      .returning();
    await evento(tx, r.id, "CREADO", descripcion, actor.id);
    await crearAviso(tx, {
      tipo: "RECLAMO_NUEVO",
      destinoRol: "SUPERVISOR",
      mensaje: `Reclamo #${r.id} del pedido #${p.id} (${p.cliente}): ${descripcion}`,
      pedidoId: p.id,
      reclamoId: r.id,
      creadoPorId: actor.id,
    });
    return { id: r.id };
  });
}

async function reclamoAbierto(tx: Tx, id: number) {
  const [r] = await tx.select().from(reclamo).where(eq(reclamo.id, id));
  return r ?? null;
}

/** El supervisor registra o actualiza causa, solución y observaciones. */
export async function analizarReclamo(
  actor: Actor,
  id: number,
  input: { causa?: string | null; solucion?: string | null; observaciones?: string | null },
): Promise<Resultado> {
  if (!puedeResolverReclamo(actor.rol)) return { error: "El análisis del reclamo lo hace el supervisor." };
  return db.transaction(async (tx) => {
    const r = await reclamoAbierto(tx, id);
    if (!r) return { error: "Reclamo no encontrado." };
    if (r.estado === "CERRADO") return { error: "El reclamo está cerrado." };
    const cambios: Partial<typeof reclamo.$inferInsert> = { estado: "EN_ANALISIS", supervisorId: r.supervisorId ?? actor.id };
    if (r.estado === "ABIERTO") await evento(tx, id, "ANALISIS", "El supervisor tomó el reclamo.", actor.id);
    for (const [campo, tipo] of [
      ["causa", "CAUSA"],
      ["solucion", "SOLUCION"],
      ["observaciones", "OBSERVACION"],
    ] as const) {
      const valor = input[campo]?.trim();
      if (valor && valor !== r[campo]) {
        cambios[campo] = valor;
        await evento(tx, id, tipo, valor, actor.id);
      }
    }
    await tx.update(reclamo).set(cambios).where(eq(reclamo.id, id));
    return {};
  });
}

export async function cerrarReclamo(actor: Actor, id: number, observaciones?: string | null): Promise<Resultado> {
  if (!puedeResolverReclamo(actor.rol)) return { error: "El reclamo lo cierra el supervisor." };
  return db.transaction(async (tx) => {
    const r = await reclamoAbierto(tx, id);
    if (!r) return { error: "Reclamo no encontrado." };
    if (r.estado === "CERRADO") return { error: "El reclamo ya está cerrado." };
    if (!r.causa || !r.solucion) return { error: "Para cerrar el reclamo hay que registrar la causa y la solución." };
    await tx
      .update(reclamo)
      .set({ estado: "CERRADO", cerradoPorId: actor.id, cerradoEn: new Date(), supervisorId: r.supervisorId ?? actor.id })
      .where(eq(reclamo.id, id));
    await evento(tx, id, "CERRADO", observaciones?.trim() || null, actor.id);
    return {};
  });
}

/** Informe a gerencia: queda como aviso para gerencia con enlace al informe. */
export async function enviarInformeGerencia(actor: Actor, id: number): Promise<Resultado> {
  if (!puedeResolverReclamo(actor.rol)) return { error: "El informe a gerencia lo envía el supervisor." };
  return db.transaction(async (tx) => {
    const r = await reclamoAbierto(tx, id);
    if (!r) return { error: "Reclamo no encontrado." };
    if (!r.causa || !r.solucion) return { error: "El informe necesita la causa y la solución." };
    await tx.update(reclamo).set({ informeEnviadoPorId: actor.id, informeEnviadoEn: new Date() }).where(eq(reclamo.id, id));
    await evento(tx, id, "INFORME", "Informe enviado a gerencia.", actor.id);
    await crearAviso(tx, {
      tipo: "INFORME_RECLAMO",
      destinoRol: "GERENCIA",
      mensaje: `Informe del reclamo #${id} (pedido #${r.pedidoId}). Causa: ${r.causa}. Solución: ${r.solucion}.`,
      pedidoId: r.pedidoId,
      reclamoId: id,
      creadoPorId: actor.id,
    });
    return {};
  });
}

const creador = alias(usuario, "reclamo_creador");
const supervisor = alias(usuario, "reclamo_supervisor");

export async function listarReclamos(filtro?: { estado?: EstadoReclamo; pedidoId?: number }) {
  return db
    .select({
      id: reclamo.id,
      pedidoId: reclamo.pedidoId,
      clienteNombre: cliente.nombre,
      estado: reclamo.estado,
      descripcion: reclamo.descripcion,
      motivoDevolucion: reclamo.motivoDevolucion,
      causa: reclamo.causa,
      creadoEn: reclamo.creadoEn,
      creadoPorNombre: creador.nombre,
      supervisorNombre: supervisor.nombre,
      informeEnviadoEn: reclamo.informeEnviadoEn,
    })
    .from(reclamo)
    .innerJoin(pedido, eq(reclamo.pedidoId, pedido.id))
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .innerJoin(creador, eq(reclamo.creadoPorId, creador.id))
    .leftJoin(supervisor, eq(reclamo.supervisorId, supervisor.id))
    .where(
      and(
        filtro?.estado ? eq(reclamo.estado, filtro.estado) : undefined,
        filtro?.pedidoId ? eq(reclamo.pedidoId, filtro.pedidoId) : undefined,
      ),
    )
    .orderBy(sql`${reclamo.estado} = 'CERRADO'`, desc(reclamo.creadoEn));
}

export async function obtenerReclamo(id: number) {
  const [r] = await db
    .select({
      r: reclamo,
      clienteNombre: cliente.nombre,
      creadoPorNombre: creador.nombre,
      supervisorNombre: supervisor.nombre,
      cajaCodigo: caja.codigoBarra,
    })
    .from(reclamo)
    .innerJoin(pedido, eq(reclamo.pedidoId, pedido.id))
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .innerJoin(creador, eq(reclamo.creadoPorId, creador.id))
    .leftJoin(supervisor, eq(reclamo.supervisorId, supervisor.id))
    .leftJoin(caja, eq(reclamo.cajaId, caja.id))
    .where(eq(reclamo.id, id));
  if (!r) return null;
  const eventos = await db
    .select({ id: reclamoEvento.id, tipo: reclamoEvento.tipo, detalle: reclamoEvento.detalle, creadoEn: reclamoEvento.creadoEn, usuarioNombre: usuario.nombre })
    .from(reclamoEvento)
    .innerJoin(usuario, eq(reclamoEvento.usuarioId, usuario.id))
    .where(eq(reclamoEvento.reclamoId, id))
    .orderBy(asc(reclamoEvento.creadoEn), asc(reclamoEvento.id));
  return { ...r.r, clienteNombre: r.clienteNombre, creadoPorNombre: r.creadoPorNombre, supervisorNombre: r.supervisorNombre, cajaCodigo: r.cajaCodigo, eventos };
}
