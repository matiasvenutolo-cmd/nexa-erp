/**
 * Despacho — total o parcial — con doble control (R5).
 *
 * Definiciones pendientes, "lo que ya está resuelto":
 *  - despacho parcial: "que se lleven los pisos y queden las rampas para la
 *    semana siguiente. El pedido queda abierto con lo que falta";
 *  - doble piqueo: "uno al pasar de armado a despacho y otro en el control
 *    final. Queda registro de quién, cuándo y qué";
 *  - aviso a ventas: "cuando el pedido pasa a despacho, administración lo recibe".
 *
 * Ciclo de un despacho:
 *   ARMANDO     se piquean cajas o productos (piqueo ARMADO);
 *   CONTROLADO  primer control confirmado → pedido LISTO_PARA_DESPACHAR + aviso;
 *   ENTREGADO   control final (piqueo CONTROL_FINAL igual a lo armado) →
 *               remito interno correlativo, salida de stock SÓLO por lo que
 *               sale, pedido PARCIALMENTE_DESPACHADO o ENTREGADO;
 *   ANULADO     se cancela antes de entregar; los piqueos quedan registrados.
 *
 * Un piqueo lee el código de una caja (P00012-C0003: trazable a su partida) o
 * el código de un producto (stock anterior a las cajas, sin partida).
 */
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/lib/db/client";
import {
  caja,
  cliente,
  despacho,
  despachoLinea,
  movimiento,
  partida,
  pedido,
  pedidoLinea,
  piqueo,
  producto,
  reserva,
  saldo,
  usuario,
} from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { puedeOperarDespacho, puedeRegistrarRemitoLegal } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { crearAviso } from "@/lib/data/avisos";
import { hoyISO } from "@/lib/format";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Ejecutor = Tx | typeof db;
export type EstadoDespacho = (typeof despacho.$inferSelect)["estado"];

export function remitoInterno(n: number | null): string {
  return n == null ? "—" : `R-${String(n).padStart(6, "0")}`;
}

const ACTIVOS: EstadoDespacho[] = ["ARMANDO", "CONTROLADO"];

async function despachoActivoDe(ex: Ejecutor, pedidoId: number) {
  const [d] = await ex
    .select()
    .from(despacho)
    .where(and(eq(despacho.pedidoId, pedidoId), inArray(despacho.estado, ACTIVOS)));
  return d ?? null;
}

/** Lee el despacho bloqueando su fila hasta el fin de la transacción: dos
 *  confirmaciones simultáneas (doble clic, dos pestañas) se serializan y la
 *  segunda ve el estado ya cambiado, así el stock no sale dos veces. */
async function despachoBloqueado(tx: Tx, despachoId: number) {
  const [d] = await tx.select().from(despacho).where(eq(despacho.id, despachoId)).for("update");
  return d ?? null;
}

/** Unidades de una caja ya comprometidas en despachos no anulados. */
async function usadoDeCajas(ex: Ejecutor, cajaIds: number[], excluirDespachoId?: number): Promise<Map<number, number>> {
  if (cajaIds.length === 0) return new Map();
  const filas = await ex
    .select({ cajaId: piqueo.cajaId, total: sql<number>`coalesce(sum(${piqueo.cantidad}), 0)`.mapWith(Number) })
    .from(piqueo)
    .innerJoin(despacho, eq(piqueo.despachoId, despacho.id))
    .where(
      and(
        inArray(piqueo.cajaId, cajaIds),
        eq(piqueo.tipo, "ARMADO"),
        eq(piqueo.conAlerta, false),
        ne(despacho.estado, "ANULADO"),
        excluirDespachoId ? ne(despacho.id, excluirDespachoId) : undefined,
      ),
    )
    .groupBy(piqueo.cajaId);
  return new Map(filas.map((f) => [f.cajaId!, f.total]));
}

/** EN_STOCK / ARMADA / DESPACHADA según cuánto de la caja está comprometido o salió. */
async function recalcularCajas(ex: Ejecutor, cajaIds: number[]) {
  const ids = [...new Set(cajaIds)];
  if (ids.length === 0) return;
  const cajas = await ex.select().from(caja).where(inArray(caja.id, ids));
  const comprometido = await usadoDeCajas(ex, ids);
  const entregado = await ex
    .select({ cajaId: piqueo.cajaId, total: sql<number>`coalesce(sum(${piqueo.cantidad}), 0)`.mapWith(Number) })
    .from(piqueo)
    .innerJoin(despacho, eq(piqueo.despachoId, despacho.id))
    .where(and(inArray(piqueo.cajaId, ids), eq(piqueo.tipo, "CONTROL_FINAL"), eq(piqueo.conAlerta, false), eq(despacho.estado, "ENTREGADO")))
    .groupBy(piqueo.cajaId);
  const salio = new Map(entregado.map((f) => [f.cajaId!, f.total]));
  for (const c of cajas) {
    if (c.estado === "BAJA") continue;
    const usado = comprometido.get(c.id) ?? 0;
    const estado = (salio.get(c.id) ?? 0) >= c.cantidad ? "DESPACHADA" : usado >= c.cantidad ? "ARMADA" : "EN_STOCK";
    if (estado !== c.estado) await ex.update(caja).set({ estado }).where(eq(caja.id, c.id));
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export type LineaSituacion = {
  lineaId: number;
  productoId: number | null;
  productoCodigo: string | null;
  productoDescripcion: string | null;
  colorTexto: string | null;
  pedido: number;
  entregado: number;
  enDespacho: number;
  pendiente: number;
};

/** Pedido / entregado / en el despacho en curso / pendiente, por renglón. */
export async function situacionLineas(pedidoId: number): Promise<LineaSituacion[]> {
  const lineas = await db
    .select({
      lineaId: pedidoLinea.id,
      productoId: pedidoLinea.productoId,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
      colorTexto: pedidoLinea.colorTexto,
      pedido: pedidoLinea.unidadesPedidas,
      entregado: pedidoLinea.unidadesDespachadas,
    })
    .from(pedidoLinea)
    .leftJoin(producto, eq(pedidoLinea.productoId, producto.id))
    .where(eq(pedidoLinea.pedidoId, pedidoId))
    .orderBy(asc(pedidoLinea.id));
  const activo = await despachoActivoDe(db, pedidoId);
  const armado = activo ? await armadoPorLinea(db, activo.id, "ARMADO") : new Map<number, number>();
  return lineas.map((l) => {
    const enDespacho = armado.get(l.lineaId) ?? 0;
    return { ...l, enDespacho, pendiente: Math.max(0, l.pedido - l.entregado - enDespacho) };
  });
}

async function armadoPorLinea(ex: Ejecutor, despachoId: number, tipo: "ARMADO" | "CONTROL_FINAL"): Promise<Map<number, number>> {
  const filas = await ex
    .select({ lineaId: piqueo.pedidoLineaId, total: sql<number>`coalesce(sum(${piqueo.cantidad}), 0)`.mapWith(Number) })
    .from(piqueo)
    .where(and(eq(piqueo.despachoId, despachoId), eq(piqueo.tipo, tipo), eq(piqueo.conAlerta, false)))
    .groupBy(piqueo.pedidoLineaId);
  return new Map(filas.map((f) => [f.lineaId!, f.total]));
}

const control1 = alias(usuario, "control1");
const controlFinal = alias(usuario, "control_final");
const creador = alias(usuario, "creador");
const remitoLegalUsuario = alias(usuario, "remito_legal_usuario");

export type DespachoDetalle = typeof despacho.$inferSelect & {
  creadoPorNombre: string | null;
  control1PorNombre: string | null;
  controlFinalPorNombre: string | null;
  remitoLegalPorNombre: string | null;
  lineas: { lineaId: number; productoCodigo: string | null; productoDescripcion: string | null; unidades: number }[];
  piqueos: {
    id: number;
    tipo: "ARMADO" | "CONTROL_FINAL";
    codigoLeido: string;
    cantidad: number;
    conAlerta: boolean;
    motivoAlerta: string | null;
    cajaCodigo: string | null;
    partidaNumero: number | null;
    productoCodigo: string | null;
    usuarioNombre: string;
    creadoEn: Date;
  }[];
};

export async function listarDespachos(pedidoId: number): Promise<DespachoDetalle[]> {
  const cabeceras = await db
    .select({
      d: despacho,
      creadoPorNombre: creador.nombre,
      control1PorNombre: control1.nombre,
      controlFinalPorNombre: controlFinal.nombre,
      remitoLegalPorNombre: remitoLegalUsuario.nombre,
    })
    .from(despacho)
    .leftJoin(creador, eq(despacho.creadoPorId, creador.id))
    .leftJoin(control1, eq(despacho.control1PorId, control1.id))
    .leftJoin(controlFinal, eq(despacho.controladoPorId, controlFinal.id))
    .leftJoin(remitoLegalUsuario, eq(despacho.remitoLegalPorId, remitoLegalUsuario.id))
    .where(eq(despacho.pedidoId, pedidoId))
    .orderBy(desc(despacho.id));
  if (cabeceras.length === 0) return [];
  const ids = cabeceras.map((c) => c.d.id);

  const lineas = await db
    .select({
      despachoId: despachoLinea.despachoId,
      lineaId: despachoLinea.pedidoLineaId,
      unidades: despachoLinea.unidades,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
    })
    .from(despachoLinea)
    .innerJoin(pedidoLinea, eq(despachoLinea.pedidoLineaId, pedidoLinea.id))
    .leftJoin(producto, eq(pedidoLinea.productoId, producto.id))
    .where(inArray(despachoLinea.despachoId, ids));

  const piqueos = await db
    .select({
      id: piqueo.id,
      despachoId: piqueo.despachoId,
      tipo: piqueo.tipo,
      codigoLeido: piqueo.codigoLeido,
      cantidad: piqueo.cantidad,
      conAlerta: piqueo.conAlerta,
      motivoAlerta: piqueo.motivoAlerta,
      cajaCodigo: caja.codigoBarra,
      partidaNumero: partida.numero,
      productoCodigo: producto.codigo,
      usuarioNombre: usuario.nombre,
      creadoEn: piqueo.creadoEn,
    })
    .from(piqueo)
    .innerJoin(usuario, eq(piqueo.usuarioId, usuario.id))
    .leftJoin(caja, eq(piqueo.cajaId, caja.id))
    .leftJoin(partida, eq(caja.partidaId, partida.id))
    .leftJoin(pedidoLinea, eq(piqueo.pedidoLineaId, pedidoLinea.id))
    .leftJoin(producto, eq(pedidoLinea.productoId, producto.id))
    .where(inArray(piqueo.despachoId, ids))
    .orderBy(asc(piqueo.id));

  return cabeceras.map((c) => ({
    ...c.d,
    creadoPorNombre: c.creadoPorNombre,
    control1PorNombre: c.control1PorNombre,
    controlFinalPorNombre: c.controlFinalPorNombre,
    remitoLegalPorNombre: c.remitoLegalPorNombre,
    lineas: lineas.filter((l) => l.despachoId === c.d.id),
    piqueos: piqueos.filter((p) => p.despachoId === c.d.id),
  }));
}

/** Cajas con unidades disponibles de los productos del pedido — ayuda al armado. */
export async function cajasDisponibles(productoIds: number[]) {
  if (productoIds.length === 0) return [];
  const filas = await db
    .select({
      id: caja.id,
      codigo: caja.codigoBarra,
      productoId: caja.productoId,
      cantidad: caja.cantidad,
      partidaNumero: partida.numero,
      fecha: caja.fecha,
    })
    .from(caja)
    .innerJoin(partida, eq(caja.partidaId, partida.id))
    .where(and(inArray(caja.productoId, productoIds), inArray(caja.estado, ["EN_STOCK"])))
    .orderBy(asc(caja.fecha), asc(caja.id));
  const usado = await usadoDeCajas(db, filas.map((f) => f.id));
  return filas
    .map((f) => ({ ...f, disponible: f.cantidad - (usado.get(f.id) ?? 0) }))
    .filter((f) => f.disponible > 0);
}

// ---------------------------------------------------------------------------
// Operación
// ---------------------------------------------------------------------------

export async function iniciarDespacho(actor: Actor, pedidoId: number): Promise<Resultado & { id?: number }> {
  if (!puedeOperarDespacho(actor.rol)) return { error: "No tenés permiso para armar despachos." };
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(pedido).where(eq(pedido.id, pedidoId)).for("update");
    if (!p) return { error: "Pedido no encontrado." };
    if (p.estado === "ENTREGADO" || p.estado === "CANCELADO") return { error: "El pedido está cerrado." };
    if (await despachoActivoDe(tx, pedidoId)) return { error: "Ya hay un despacho en curso para este pedido." };
    const lineas = await tx.select().from(pedidoLinea).where(eq(pedidoLinea.pedidoId, pedidoId));
    if (!lineas.some((l) => l.productoId != null && l.unidadesPedidas > l.unidadesDespachadas)) {
      return { error: "No hay nada pendiente de entregar con producto asignado." };
    }
    const [d] = await tx
      .insert(despacho)
      .values({
        pedidoId,
        estado: "ARMANDO",
        fecha: hoyISO(),
        modoEntrega: p.modoEntrega,
        transporte: p.transporte,
        creadoPorId: actor.id,
      })
      .returning();
    await tx.update(pedido).set({ estado: "EN_ARMADO" }).where(eq(pedido.id, pedidoId));
    return { id: d.id };
  });
}

export type ResultadoPiqueo = Resultado & { alerta?: string; ok?: string };

/**
 * Registra una lectura (piqueo). Una lectura que no corresponde al pedido, o
 * que excede lo pendiente, QUEDA REGISTRADA con su alerta ("piqué un borde
 * rojo rejilla y me tiene que dar una alerta de que está mal") pero no suma.
 */
export async function piquear(
  actor: Actor,
  despachoId: number,
  input: { codigo: string; cantidad?: number | null },
): Promise<ResultadoPiqueo> {
  if (!puedeOperarDespacho(actor.rol)) return { error: "No tenés permiso para piquear." };
  const codigo = input.codigo.trim().toUpperCase();
  if (!codigo) return { error: "Leé o escribí un código." };
  if (input.cantidad != null && (!Number.isInteger(input.cantidad) || input.cantidad <= 0)) {
    return { error: "La cantidad tiene que ser un número entero mayor que cero." };
  }

  const depositoId = await getDepositoNexaId();
  return db.transaction(async (tx) => {
    const d = await despachoBloqueado(tx, despachoId);
    if (!d) return { error: "Despacho no encontrado." };
    const tipo = d.estado === "ARMANDO" ? "ARMADO" : d.estado === "CONTROLADO" ? "CONTROL_FINAL" : null;
    if (!tipo) return { error: "Este despacho ya no admite lecturas." };

    // ¿Caja o producto?
    const [c] = await tx.select().from(caja).where(eq(caja.codigoBarra, codigo));
    let productoId: number | null = c?.productoId ?? null;
    if (!c) {
      const [p] = await tx
        .select({ id: producto.id })
        .from(producto)
        .where(sql`upper(${producto.codigo}) = ${codigo} or upper(${producto.codigoBarras}) = ${codigo}`);
      productoId = p?.id ?? null;
    }

    const registrar = async (cantidad: number, lineaId: number | null, alerta: string | null) => {
      await tx.insert(piqueo).values({
        tipo,
        pedidoId: d.pedidoId,
        pedidoLineaId: lineaId,
        cajaId: c?.id ?? null,
        despachoId,
        codigoLeido: codigo,
        cantidad,
        conAlerta: alerta != null,
        motivoAlerta: alerta,
        usuarioId: actor.id,
      });
    };

    if (productoId == null) {
      await registrar(input.cantidad ?? 1, null, "Código desconocido: no es una caja ni un producto del catálogo.");
      return { alerta: `El código ${codigo} no corresponde a ninguna caja ni producto.` };
    }
    const [linea] = await tx
      .select()
      .from(pedidoLinea)
      .where(and(eq(pedidoLinea.pedidoId, d.pedidoId), eq(pedidoLinea.productoId, productoId)));
    if (!linea) {
      await registrar(input.cantidad ?? (c?.cantidad ?? 1), null, "El producto no está en el pedido.");
      return { alerta: `${codigo}: ese producto no está en este pedido.` };
    }

    if (tipo === "ARMADO") {
      // Serializa el armado del mismo producto entre despachos distintos (dos
      // pedidos que leen la misma caja o el mismo stock al mismo tiempo).
      const [s] = await tx
        .select({ cantidad: saldo.cantidad })
        .from(saldo)
        .where(and(eq(saldo.depositoId, depositoId), eq(saldo.productoId, productoId)))
        .for("update");
      const armado = (await armadoPorLinea(tx, despachoId, "ARMADO")).get(linea.id) ?? 0;
      const pendiente = linea.unidadesPedidas - linea.unidadesDespachadas - armado;
      let disponibleCaja = Infinity;
      if (c) {
        if (c.estado === "BAJA") {
          await registrar(input.cantidad ?? c.cantidad, linea.id, "Caja dada de baja.");
          return { alerta: `La caja ${codigo} está dada de baja.` };
        }
        disponibleCaja = c.cantidad - ((await usadoDeCajas(tx, [c.id])).get(c.id) ?? 0);
      }
      const cantidad = input.cantidad ?? (c ? Math.min(disponibleCaja, pendiente) : 1);
      if (c && disponibleCaja <= 0) {
        await registrar(input.cantidad ?? 0, linea.id, "La caja no tiene unidades disponibles (ya fue armada).");
        return { alerta: `La caja ${codigo} ya está armada: no tiene unidades disponibles.` };
      }
      if (pendiente <= 0) {
        await registrar(cantidad, linea.id, "El renglón ya está completo.");
        return { alerta: `${codigo}: ese renglón ya está completo en este despacho.` };
      }
      if (cantidad > pendiente) {
        await registrar(cantidad, linea.id, `Excede lo pendiente (${pendiente}).`);
        return { alerta: `${codigo}: ${cantidad} excede lo pendiente del renglón (${pendiente}).` };
      }
      if (cantidad > disponibleCaja) {
        await registrar(cantidad, linea.id, `La caja tiene ${disponibleCaja} disponibles.`);
        return { alerta: `La caja ${codigo} tiene ${disponibleCaja} unidades disponibles.` };
      }
      if (!c) {
        // Stock sin caja: lo que hay, menos lo ya armado en despachos en curso y
        // menos lo que sigue guardado en cajas sin comprometer (eso se arma
        // leyendo la caja; si no, la misma unidad se comprometería dos veces).
        const enDespachosActivos = await tx
          .select({ total: sql<number>`coalesce(sum(${piqueo.cantidad}), 0)`.mapWith(Number) })
          .from(piqueo)
          .innerJoin(despacho, eq(piqueo.despachoId, despacho.id))
          .innerJoin(pedidoLinea, eq(piqueo.pedidoLineaId, pedidoLinea.id))
          .where(
            and(
              eq(pedidoLinea.productoId, productoId),
              eq(piqueo.tipo, "ARMADO"),
              eq(piqueo.conAlerta, false),
              inArray(despacho.estado, ACTIVOS),
            ),
          );
        const cajasDelProducto = await tx
          .select({ id: caja.id, cantidad: caja.cantidad })
          .from(caja)
          .where(and(eq(caja.productoId, productoId), inArray(caja.estado, ["EN_STOCK", "ARMADA"])));
        const usadoCajas = await usadoDeCajas(tx, cajasDelProducto.map((x) => x.id));
        const enCajas = cajasDelProducto.reduce((t, x) => t + Math.max(0, x.cantidad - (usadoCajas.get(x.id) ?? 0)), 0);
        const libre = Number(s?.cantidad ?? 0) - enDespachosActivos[0].total - enCajas;
        if (cantidad > libre) {
          await registrar(cantidad, linea.id, `Stock insuficiente (${Math.max(0, libre)} libres).`);
          return {
            alerta:
              `No hay stock suficiente sin caja: ${Math.max(0, libre)} unidades libres.` +
              (enCajas > 0 ? ` Hay ${enCajas} en cajas: leé el código de la caja.` : ""),
          };
        }
      }
      await registrar(cantidad, linea.id, null);
      if (c) await recalcularCajas(tx, [c.id]);
      return { ok: `${codigo}: ${cantidad} unidades armadas.` };
    }

    // CONTROL_FINAL: tiene que coincidir con lo armado (misma caja o mismo producto sin caja).
    const armadas = await tx
      .select({ total: sql<number>`coalesce(sum(${piqueo.cantidad}), 0)`.mapWith(Number) })
      .from(piqueo)
      .where(
        and(
          eq(piqueo.despachoId, despachoId),
          eq(piqueo.tipo, "ARMADO"),
          eq(piqueo.conAlerta, false),
          eq(piqueo.pedidoLineaId, linea.id),
          c ? eq(piqueo.cajaId, c.id) : sql`${piqueo.cajaId} is null`,
        ),
      );
    const controladas = await tx
      .select({ total: sql<number>`coalesce(sum(${piqueo.cantidad}), 0)`.mapWith(Number) })
      .from(piqueo)
      .where(
        and(
          eq(piqueo.despachoId, despachoId),
          eq(piqueo.tipo, "CONTROL_FINAL"),
          eq(piqueo.conAlerta, false),
          eq(piqueo.pedidoLineaId, linea.id),
          c ? eq(piqueo.cajaId, c.id) : sql`${piqueo.cajaId} is null`,
        ),
      );
    const falta = armadas[0].total - controladas[0].total;
    const cantidad = input.cantidad ?? (c ? falta : 1);
    if (armadas[0].total === 0) {
      await registrar(cantidad, linea.id, "No fue armado en este despacho.");
      return { alerta: `${codigo}: no forma parte de lo armado en este despacho.` };
    }
    if (falta <= 0) {
      await registrar(input.cantidad ?? 0, linea.id, "Ya estaba controlado.");
      return { alerta: `${codigo}: ya fue controlado.` };
    }
    if (cantidad > falta) {
      await registrar(cantidad, linea.id, `Excede lo armado (faltan controlar ${falta}).`);
      return { alerta: `${codigo}: excede lo armado (faltan controlar ${falta}).` };
    }
    await registrar(cantidad, linea.id, null);
    return { ok: `${codigo}: ${cantidad} unidades controladas.` };
  });
}

function describir(lineas: { codigo: string | null; unidades: number; pendiente: number }[]): string {
  const faltantes = lineas.filter((l) => l.pendiente > 0);
  const total = lineas.reduce((s, l) => s + l.unidades, 0);
  if (faltantes.length === 0) return `Completo: ${total} unidades, no queda nada pendiente.`;
  return `Parcial: ${total} unidades. Queda pendiente: ${faltantes.map((l) => `${l.codigo ?? "sin producto"} ×${l.pendiente}`).join(", ")}.`;
}

/** Primer control: cierra el armado, el pedido queda listo y se avisa a ventas. */
export async function confirmarPrimerControl(actor: Actor, despachoId: number, observaciones?: string | null): Promise<Resultado> {
  if (!puedeOperarDespacho(actor.rol)) return { error: "No tenés permiso para controlar despachos." };
  return db.transaction(async (tx) => {
    const d = await despachoBloqueado(tx, despachoId);
    if (!d) return { error: "Despacho no encontrado." };
    if (d.estado !== "ARMANDO") return { error: "El primer control ya se hizo o el despacho no está en armado." };
    const armado = await armadoPorLinea(tx, despachoId, "ARMADO");
    if ([...armado.values()].every((v) => v === 0)) return { error: "No hay nada armado: piqueá al menos una caja o producto." };

    const lineas = await tx
      .select({ id: pedidoLinea.id, pedidas: pedidoLinea.unidadesPedidas, despachadas: pedidoLinea.unidadesDespachadas, codigo: producto.codigo })
      .from(pedidoLinea)
      .leftJoin(producto, eq(pedidoLinea.productoId, producto.id))
      .where(eq(pedidoLinea.pedidoId, d.pedidoId));
    const resumen = lineas.map((l) => {
      const unidades = armado.get(l.id) ?? 0;
      return { ...l, unidades, pendiente: l.pedidas - l.despachadas - unidades };
    });
    for (const l of resumen) {
      if (l.unidades > 0) await tx.insert(despachoLinea).values({ despachoId, pedidoLineaId: l.id, unidades: l.unidades });
      await tx.update(pedidoLinea).set({ unidadesArmadas: l.despachadas + l.unidades }).where(eq(pedidoLinea.id, l.id));
    }
    const resultado = describir(resumen) + (observaciones?.trim() ? ` Obs.: ${observaciones.trim()}` : "");
    await tx
      .update(despacho)
      .set({ estado: "CONTROLADO", control1PorId: actor.id, control1En: new Date(), control1Resultado: resultado })
      .where(eq(despacho.id, despachoId));
    await tx.update(pedido).set({ estado: "LISTO_PARA_DESPACHAR" }).where(eq(pedido.id, d.pedidoId));

    const [cab] = await tx
      .select({ cliente: cliente.nombre })
      .from(pedido)
      .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
      .where(eq(pedido.id, d.pedidoId));
    await crearAviso(tx, {
      tipo: "PEDIDO_LISTO",
      destinoRol: "ADMINISTRACION",
      mensaje: `Pedido #${d.pedidoId} (${cab.cliente}) listo para despachar. ${resultado}`,
      pedidoId: d.pedidoId,
      despachoId,
      creadoPorId: actor.id,
    });
    return {};
  });
}

/**
 * Control final y entrega. Lo controlado tiene que coincidir exactamente con
 * lo armado; recién ahí sale el stock (sólo lo que efectivamente se va), se
 * asigna el remito interno correlativo y el pedido queda parcial o entregado.
 */
export async function confirmarControlFinal(actor: Actor, despachoId: number, observaciones?: string | null): Promise<Resultado & { remito?: string }> {
  if (!puedeOperarDespacho(actor.rol)) return { error: "No tenés permiso para controlar despachos." };
  const depositoId = await getDepositoNexaId();
  return db.transaction(async (tx) => {
    const d = await despachoBloqueado(tx, despachoId);
    if (!d) return { error: "Despacho no encontrado." };
    if (d.estado !== "CONTROLADO") return { error: "Falta el primer control: no se puede hacer el control final." };

    const lecturas = await tx
      .select({
        tipo: piqueo.tipo,
        lineaId: piqueo.pedidoLineaId,
        cajaId: piqueo.cajaId,
        cantidad: piqueo.cantidad,
      })
      .from(piqueo)
      .where(and(eq(piqueo.despachoId, despachoId), eq(piqueo.conAlerta, false)));
    const clave = (l: { lineaId: number | null; cajaId: number | null }) => `${l.lineaId}:${l.cajaId ?? "-"}`;
    const armado = new Map<string, number>();
    const controlado = new Map<string, number>();
    for (const l of lecturas) {
      const m = l.tipo === "ARMADO" ? armado : controlado;
      m.set(clave(l), (m.get(clave(l)) ?? 0) + l.cantidad);
    }
    const diferencias = [...armado].filter(([k, v]) => (controlado.get(k) ?? 0) !== v);
    if (diferencias.length > 0) {
      return { error: `El control final no coincide con lo armado en ${diferencias.length} lectura(s): falta piquear lo que se va a entregar.` };
    }

    const [{ n }] = await tx.execute<{ n: string }>(sql`select nextval('remito_interno_seq') as n`).then((r) =>
      "rows" in r ? (r.rows as { n: string }[]) : (r as unknown as { n: string }[]),
    );
    const numeroInterno = Number(n);

    const finales = await tx
      .select({
        cajaId: piqueo.cajaId,
        cantidad: piqueo.cantidad,
        lineaId: piqueo.pedidoLineaId,
        productoId: pedidoLinea.productoId,
        partidaId: caja.partidaId,
      })
      .from(piqueo)
      .innerJoin(pedidoLinea, eq(piqueo.pedidoLineaId, pedidoLinea.id))
      .leftJoin(caja, eq(piqueo.cajaId, caja.id))
      .where(and(eq(piqueo.despachoId, despachoId), eq(piqueo.tipo, "CONTROL_FINAL"), eq(piqueo.conAlerta, false)));

    const porLinea = new Map<number, { productoId: number; unidades: number }>();
    for (const f of finales) {
      await tx.insert(movimiento).values({
        tipo: "SALIDA",
        depositoId,
        productoId: f.productoId!,
        cajaId: f.cajaId,
        partidaId: f.partidaId,
        cantidad: String(f.cantidad),
        origen: "PEDIDO",
        origenId: d.pedidoId,
        motivo: `Entrega pedido ${d.pedidoId} · remito interno ${remitoInterno(numeroInterno)}`,
        usuarioId: actor.id,
      });
      const acc = porLinea.get(f.lineaId!) ?? { productoId: f.productoId!, unidades: 0 };
      acc.unidades += f.cantidad;
      porLinea.set(f.lineaId!, acc);
    }

    for (const [lineaId, { productoId, unidades }] of porLinea) {
      await tx
        .insert(saldo)
        .values({ depositoId, productoId, cantidad: String(-unidades) })
        .onConflictDoUpdate({ target: [saldo.depositoId, saldo.productoId], set: { cantidad: sql`${saldo.cantidad} - ${unidades}` } });
      await tx
        .update(pedidoLinea)
        .set({ unidadesDespachadas: sql`${pedidoLinea.unidadesDespachadas} + ${unidades}` })
        .where(eq(pedidoLinea.id, lineaId));
      // La reserva baja por lo entregado; se consume cuando llega a cero.
      const [r] = await tx
        .select()
        .from(reserva)
        .where(and(eq(reserva.pedidoLineaId, lineaId), eq(reserva.estado, "ABIERTA")));
      if (r) {
        const resto = Number(r.cantidad) - unidades;
        await tx
          .update(reserva)
          .set(resto > 0 ? { cantidad: String(resto) } : { cantidad: "0", estado: "CONSUMIDA", cerradoEn: new Date() })
          .where(eq(reserva.id, r.id));
      }
    }

    const lineas = await tx.select().from(pedidoLinea).where(eq(pedidoLinea.pedidoId, d.pedidoId));
    const completo = lineas.every((l) => l.unidadesDespachadas >= l.unidadesPedidas);
    const resultado = (completo ? "Entrega completa." : "Entrega parcial: el pedido sigue abierto con lo pendiente.") +
      (observaciones?.trim() ? ` Obs.: ${observaciones.trim()}` : "");
    await tx
      .update(despacho)
      .set({
        estado: "ENTREGADO",
        numeroInterno,
        controladoPorId: actor.id,
        controlFinalEn: new Date(),
        controlFinalResultado: resultado,
        entregadoEn: new Date(),
      })
      .where(eq(despacho.id, despachoId));
    await tx.update(pedido).set({ estado: completo ? "ENTREGADO" : "PARCIALMENTE_DESPACHADO" }).where(eq(pedido.id, d.pedidoId));
    await recalcularCajas(tx, finales.map((f) => f.cajaId).filter((x): x is number => x != null));
    return { remito: remitoInterno(numeroInterno) };
  });
}

/** Anula un despacho no entregado: libera las cajas; los piqueos quedan como registro. */
export async function anularDespacho(actor: Actor, despachoId: number, motivo: string | null): Promise<Resultado> {
  if (!puedeOperarDespacho(actor.rol)) return { error: "No tenés permiso para anular despachos." };
  if (!motivo?.trim()) return { error: "Indicá el motivo de la anulación." };
  return db.transaction(async (tx) => anularEnTx(tx, actor, despachoId, motivo.trim()));
}

async function anularEnTx(tx: Tx, actor: Actor, despachoId: number, motivo: string): Promise<Resultado> {
  const d = await despachoBloqueado(tx, despachoId);
  if (!d) return { error: "Despacho no encontrado." };
  if (!ACTIVOS.includes(d.estado)) return { error: "Sólo se anula un despacho que todavía no se entregó." };
  await tx.update(despacho).set({ estado: "ANULADO", observaciones: `Anulado: ${motivo}` }).where(eq(despacho.id, despachoId));
  await tx.delete(despachoLinea).where(eq(despachoLinea.despachoId, despachoId));
  const lineas = await tx.select().from(pedidoLinea).where(eq(pedidoLinea.pedidoId, d.pedidoId));
  for (const l of lineas) {
    if (l.unidadesArmadas !== l.unidadesDespachadas) {
      await tx.update(pedidoLinea).set({ unidadesArmadas: l.unidadesDespachadas }).where(eq(pedidoLinea.id, l.id));
    }
  }
  const algoEntregado = lineas.some((l) => l.unidadesDespachadas > 0);
  const [p] = await tx.select({ estado: pedido.estado }).from(pedido).where(eq(pedido.id, d.pedidoId));
  if (p.estado !== "CANCELADO") {
    await tx.update(pedido).set({ estado: algoEntregado ? "PARCIALMENTE_DESPACHADO" : "PEDIDO" }).where(eq(pedido.id, d.pedidoId));
  }
  const cajas = await tx.select({ cajaId: piqueo.cajaId }).from(piqueo).where(eq(piqueo.despachoId, despachoId));
  await recalcularCajas(tx, cajas.map((c) => c.cajaId).filter((x): x is number => x != null));
  await registrarCambios(tx, actor.id, [
    { entidad: "despacho", entidadId: despachoId, campo: "estado", anterior: d.estado, nuevo: "ANULADO", motivo },
  ]);
  return {};
}

/** Si se cancela un pedido con un despacho en curso, el despacho se anula. */
export async function anularDespachoActivoEnTx(tx: Tx, actor: Actor, pedidoId: number): Promise<Resultado> {
  const activo = await despachoActivoDe(tx, pedidoId);
  if (!activo) return {};
  const r = await anularEnTx(tx, actor, activo.id, "Pedido cancelado");
  // Si el control final se confirmó en el medio, el despacho ya se entregó.
  return r.error ? { error: "El despacho en curso acaba de entregarse: revisá el pedido antes de cancelarlo." } : {};
}

/** El N° del remito legal que emite administración, asociado al despacho. */
export async function registrarRemitoLegal(actor: Actor, despachoId: number, numero: string): Promise<Resultado> {
  if (!puedeRegistrarRemitoLegal(actor.rol)) return { error: "El remito legal lo registra Administración." };
  const valor = numero.trim();
  if (!valor) return { error: "Falta el número de remito legal." };
  return db.transaction(async (tx) => {
    const d = await despachoBloqueado(tx, despachoId);
    if (!d) return { error: "Despacho no encontrado." };
    if (d.estado !== "ENTREGADO") return { error: "El remito legal se registra sobre un despacho entregado." };
    await tx.update(despacho).set({ numeroRemito: valor, remitoLegalPorId: actor.id, remitoLegalEn: new Date() }).where(eq(despacho.id, despachoId));
    await registrarCambios(tx, actor.id, [
      { entidad: "despacho", entidadId: despachoId, campo: "numero_remito_legal", anterior: d.numeroRemito, nuevo: valor },
    ]);
    return {};
  });
}

/** Para el remito impreso. */
export async function obtenerDespachoParaRemito(despachoId: number) {
  const [cab] = await db
    .select({
      d: despacho,
      pedidoId: pedido.id,
      numeroOrden: pedido.numeroOrden,
      clienteNombre: cliente.nombre,
      clienteCuit: cliente.cuit,
      domicilio: sql<string | null>`coalesce(${pedido.domicilioEntrega}, ${cliente.domicilio})`,
      contacto: pedido.contacto,
    })
    .from(despacho)
    .innerJoin(pedido, eq(despacho.pedidoId, pedido.id))
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .where(eq(despacho.id, despachoId));
  if (!cab) return null;
  const items = await db
    .select({ codigo: producto.codigo, descripcion: producto.descripcion, unidades: despachoLinea.unidades })
    .from(despachoLinea)
    .innerJoin(pedidoLinea, eq(despachoLinea.pedidoLineaId, pedidoLinea.id))
    .leftJoin(producto, eq(pedidoLinea.productoId, producto.id))
    .where(eq(despachoLinea.despachoId, despachoId));
  return { ...cab, items };
}
