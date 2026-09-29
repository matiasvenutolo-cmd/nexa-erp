/**
 * Producción — paso 4 del release combinado (docs/07-plan-release-2.md).
 *
 * Carga por día (decisión de Matías, 29/09/2026 — ver docs/06-comentarios-
 * produccion.md §3.2 y §7): el operario cierra el ciclo al final de cada
 * jornada aunque siga con el mismo color al día siguiente. La continuidad
 * entre días se sostiene con la PARTIDA (agrupa todo lo inyectado con la
 * misma combinación de material/color) y con golpesInicio = golpesFin del
 * día anterior — nunca con un ciclo que abarque varios días.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  cicloProduccion,
  cicloPedido,
  partida,
  producto,
  usuario,
  pedido,
  pedidoLinea,
  cliente,
  movimiento,
  saldo,
} from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";

/** Lista chica para el select del alta de ciclo — no la del catálogo completo,
 *  que trae stock/semáforo que acá no hace falta. */
export async function productosParaCiclo() {
  return db
    .select({ id: producto.id, codigo: producto.codigo, descripcion: producto.descripcion, piezasPorGolpe: producto.piezasPorGolpe })
    .from(producto)
    .where(eq(producto.activo, true))
    .orderBy(asc(producto.codigo));
}

/** Partidas todavía abiertas de un producto — para continuar en vez de abrir
 *  una nueva cuando se sigue con el mismo color al día siguiente. */
export async function partidasAbiertasDe(productoId: number) {
  return db
    .select({ id: partida.id, numero: partida.numero, fechaApertura: partida.fechaApertura })
    .from(partida)
    .where(and(eq(partida.productoId, productoId), isNull(partida.fechaCierre)))
    .orderBy(desc(partida.fechaApertura));
}

/** El último ciclo cerrado de una partida — de ahí se sugieren los golpes de
 *  inicio del día siguiente. */
export async function ultimoCicloDePartida(partidaId: number) {
  const [c] = await db
    .select()
    .from(cicloProduccion)
    .where(eq(cicloProduccion.partidaId, partidaId))
    .orderBy(desc(cicloProduccion.fechaInicio))
    .limit(1);
  return c ?? null;
}

export type NuevoCicloInput = {
  fecha: string;
  inyectora: string;
  productoId: number;
  operarioId: number | null;
  golpesInicio: number | null;
  piezasPorGolpe: number | null;
  cicloSegundos: string | null;
  modo: string | null;
  partidaId: number | null; // null = crear una nueva
  pedidos: { pedidoId: number; cantidadAsignada: number }[];
  usuarioId: number;
};

/** Alta del día — Paso 1 (inicio). Si no se elige una partida abierta para
 *  continuar, genera una nueva con número correlativo (nunca se tipea). */
export async function crearCiclo(input: NuevoCicloInput): Promise<{ id: number }> {
  return db.transaction(async (tx) => {
    let partidaId = input.partidaId;
    if (!partidaId) {
      const [{ maxNumero }] = await tx
        .select({ maxNumero: sql<number>`coalesce(max(${partida.numero}), 0)`.mapWith(Number) })
        .from(partida);
      const [nueva] = await tx
        .insert(partida)
        .values({ numero: maxNumero + 1, productoId: input.productoId, fechaApertura: input.fecha })
        .returning();
      partidaId = nueva.id;
    }

    const [ciclo] = await tx
      .insert(cicloProduccion)
      .values({
        partidaId,
        productoId: input.productoId,
        inyectora: input.inyectora,
        fechaInicio: new Date(`${input.fecha}T00:00:00`),
        golpesInicio: input.golpesInicio,
        piezasPorGolpe: input.piezasPorGolpe,
        cicloSegundos: input.cicloSegundos,
        modo: input.modo,
        operarioId: input.operarioId,
        usuarioId: input.usuarioId,
      })
      .returning();

    for (const p of input.pedidos) {
      if (p.cantidadAsignada > 0) {
        await tx.insert(cicloPedido).values({ cicloId: ciclo.id, pedidoId: p.pedidoId, cantidadAsignada: p.cantidadAsignada });
      }
    }

    return { id: ciclo.id };
  });
}

export type FinCicloInput = {
  golpesFin: number | null;
  piezasDescartadas: number | null;
  piezasEntregadas: number | null;
  coladaKg: string | null;
  rebarbaKg: string | null;
  scrapKg: string | null;
  cambioCicloCausa: string | null;
  observaciones: string | null;
  cerrarPartida: boolean;
  usuarioId: number;
};

/**
 * Cierre del día — Paso 2 (fin). Genera el movimiento de ENTRADA real con
 * `piezasEntregadas` (regla 2 de AGENTS.md: nunca se toca `saldo` sin su
 * movimiento).
 */
export async function cerrarCiclo(cicloId: number, input: FinCicloInput): Promise<{ error?: string }> {
  const ciclo = await db.query.cicloProduccion.findFirst({ where: eq(cicloProduccion.id, cicloId) });
  if (!ciclo) return { error: "Ciclo no encontrado." };
  if (ciclo.fechaFin) return { error: "Este ciclo ya está cerrado." };

  const piezasProducidas =
    input.golpesFin != null && ciclo.golpesInicio != null && ciclo.piezasPorGolpe != null
      ? (input.golpesFin - ciclo.golpesInicio) * ciclo.piezasPorGolpe
      : null;

  const depositoId = await getDepositoNexaId();

  await db.transaction(async (tx) => {
    await tx
      .update(cicloProduccion)
      .set({
        fechaFin: new Date(),
        golpesFin: input.golpesFin,
        piezasProducidas,
        piezasDescartadas: input.piezasDescartadas,
        piezasEntregadas: input.piezasEntregadas,
        coladaKg: input.coladaKg,
        rebarbaKg: input.rebarbaKg,
        scrapKg: input.scrapKg,
        cambioCicloCausa: input.cambioCicloCausa,
        observaciones: input.observaciones,
      })
      .where(eq(cicloProduccion.id, cicloId));

    if (ciclo.productoId != null && input.piezasEntregadas != null && input.piezasEntregadas > 0) {
      await tx.insert(movimiento).values({
        tipo: "ENTRADA",
        depositoId,
        productoId: ciclo.productoId,
        partidaId: ciclo.partidaId,
        cantidad: String(input.piezasEntregadas),
        origen: "CICLO",
        origenId: cicloId,
        motivo: `Ciclo #${cicloId}${ciclo.partidaId ? ` · partida ${ciclo.partidaId}` : ""}`,
        usuarioId: input.usuarioId,
      });
      await tx
        .insert(saldo)
        .values({ depositoId, productoId: ciclo.productoId, cantidad: String(input.piezasEntregadas) })
        .onConflictDoUpdate({
          target: [saldo.depositoId, saldo.productoId],
          set: { cantidad: sql`${saldo.cantidad} + ${input.piezasEntregadas}` },
        });
    }

    if (input.cerrarPartida && ciclo.partidaId) {
      await tx.update(partida).set({ fechaCierre: new Date().toISOString().slice(0, 10) }).where(eq(partida.id, ciclo.partidaId));
    }
  });

  return {};
}

export type FilaCiclo = {
  id: number;
  fechaInicio: Date;
  fechaFin: Date | null;
  inyectora: string;
  productoCodigo: string | null;
  productoDescripcion: string | null;
  partidaNumero: number | null;
  operarioNombre: string | null;
  golpesInicio: number | null;
  golpesFin: number | null;
  piezasProducidas: number | null;
  piezasDescartadas: number | null;
  piezasEntregadas: number | null;
};

export async function listarCiclos(limite = 100): Promise<FilaCiclo[]> {
  const operario = usuario;
  const filas = await db
    .select({
      id: cicloProduccion.id,
      fechaInicio: cicloProduccion.fechaInicio,
      fechaFin: cicloProduccion.fechaFin,
      inyectora: cicloProduccion.inyectora,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
      partidaNumero: partida.numero,
      operarioNombre: operario.nombre,
      golpesInicio: cicloProduccion.golpesInicio,
      golpesFin: cicloProduccion.golpesFin,
      piezasProducidas: cicloProduccion.piezasProducidas,
      piezasDescartadas: cicloProduccion.piezasDescartadas,
      piezasEntregadas: cicloProduccion.piezasEntregadas,
    })
    .from(cicloProduccion)
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .leftJoin(partida, eq(cicloProduccion.partidaId, partida.id))
    .leftJoin(operario, eq(cicloProduccion.operarioId, operario.id))
    .orderBy(desc(cicloProduccion.fechaInicio))
    .limit(limite);
  return filas;
}

export type CicloConDetalle = typeof cicloProduccion.$inferSelect & {
  productoCodigo: string | null;
  productoDescripcion: string | null;
  partidaNumero: number | null;
  operarioNombre: string | null;
  pedidos: { pedidoId: number; clienteNombre: string; cantidadAsignada: number }[];
};

export async function obtenerCiclo(id: number): Promise<CicloConDetalle | null> {
  const [fila] = await db
    .select({
      ciclo: cicloProduccion,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
      partidaNumero: partida.numero,
      operarioNombre: usuario.nombre,
    })
    .from(cicloProduccion)
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .leftJoin(partida, eq(cicloProduccion.partidaId, partida.id))
    .leftJoin(usuario, eq(cicloProduccion.operarioId, usuario.id))
    .where(eq(cicloProduccion.id, id));
  if (!fila) return null;

  const pedidos = await db
    .select({ pedidoId: cicloPedido.pedidoId, clienteNombre: cliente.nombre, cantidadAsignada: cicloPedido.cantidadAsignada })
    .from(cicloPedido)
    .innerJoin(pedido, eq(cicloPedido.pedidoId, pedido.id))
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .where(eq(cicloPedido.cicloId, id));

  return { ...fila.ciclo, productoCodigo: fila.productoCodigo, productoDescripcion: fila.productoDescripcion, partidaNumero: fila.partidaNumero, operarioNombre: fila.operarioNombre, pedidos };
}

export type PedidoNecesitaProducto = {
  pedidoId: number;
  clienteNombre: string;
  fechaPedido: string;
  cantidad: number;
};

/** Pedidos abiertos que necesitan un producto — para elegir a cuáles cubre
 *  el ciclo que se está cargando (docs/06-comentarios-produccion.md §3.1). */
export async function pedidosQueNecesitan(productoId: number): Promise<PedidoNecesitaProducto[]> {
  const filas = await db
    .select({
      pedidoId: pedido.id,
      clienteNombre: cliente.nombre,
      fechaPedido: pedido.fechaPedido,
      cantidad: pedidoLinea.unidadesPedidas,
    })
    .from(pedidoLinea)
    .innerJoin(pedido, eq(pedidoLinea.pedidoId, pedido.id))
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .where(
      and(
        eq(pedidoLinea.productoId, productoId),
        sql`${pedido.estado} not in ('ENTREGADO', 'CANCELADO')`,
      ),
    )
    .orderBy(pedido.prioridad, pedido.fechaPedido);
  return filas;
}
