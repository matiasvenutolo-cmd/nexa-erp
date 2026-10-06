/**
 * Trazabilidad completa, en los dos sentidos (Definiciones pendientes: "desde
 * el certificado de calidad del proveedor hasta la caja que recibió el
 * cliente: dado un reclamo, qué lote se usó; y dado un lote fallado, qué cajas
 * salieron y a qué clientes").
 *
 * La cadena usa sólo lo que ya registra la operación — nada se carga aparte:
 *   certificado ← lote ← retiro a máquina (ciclo_materia_prima) → ciclo →
 *   partida → caja → piqueo de control final → despacho entregado → pedido →
 *   cliente.
 */
import { and, asc, eq, ilike, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  caja,
  certificadoCalidad,
  cicloMateriaPrima,
  cicloProduccion,
  cliente,
  despacho,
  loteMp,
  materiaPrima,
  partida,
  pedido,
  pedidoLinea,
  piqueo,
  producto,
} from "@/lib/db/schema";
import { codigoDeUso } from "@/lib/data/materia-prima";
import { remitoInterno } from "@/lib/data/despachos";

export type OrigenPartida = {
  partidaId: number;
  numero: number;
  productoCodigo: string | null;
  productoDescripcion: string | null;
  fechaApertura: string;
  fechaCierre: string | null;
  ciclos: { id: number; fechaInicio: Date; inyectora: string; piezasEntregadas: number | null }[];
  materiales: {
    cicloId: number;
    materiaPrimaNombre: string;
    kg: number;
    esMaster: boolean;
    loteId: number | null;
    loteCodigo: string | null;
    codigoUso: string | null;
    certificadoNumero: number | null;
    proveedor: string | null;
  }[];
};

/** Hacia atrás: de qué ciclos, lotes y certificados salió cada partida. */
export async function origenDePartidas(partidaIds: number[]): Promise<OrigenPartida[]> {
  const ids = [...new Set(partidaIds)];
  if (ids.length === 0) return [];
  const partidas = await db
    .select({
      partidaId: partida.id,
      numero: partida.numero,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
      productoNumero: producto.numero,
      fechaApertura: partida.fechaApertura,
      fechaCierre: partida.fechaCierre,
    })
    .from(partida)
    .leftJoin(producto, eq(partida.productoId, producto.id))
    .where(inArray(partida.id, ids))
    .orderBy(asc(partida.numero));
  const ciclos = await db
    .select({
      id: cicloProduccion.id,
      partidaId: cicloProduccion.partidaId,
      fechaInicio: cicloProduccion.fechaInicio,
      inyectora: cicloProduccion.inyectora,
      piezasEntregadas: cicloProduccion.piezasEntregadas,
    })
    .from(cicloProduccion)
    .where(inArray(cicloProduccion.partidaId, ids))
    .orderBy(asc(cicloProduccion.fechaInicio));
  const cicloIds = ciclos.map((c) => c.id);
  const materiales = cicloIds.length
    ? await db
        .select({
          cicloId: cicloMateriaPrima.cicloId,
          materiaPrimaNombre: materiaPrima.nombre,
          kg: cicloMateriaPrima.cantidadKg,
          esMaster: cicloMateriaPrima.esMaster,
          loteId: loteMp.id,
          loteCodigo: loteMp.codigoBarra,
          certificadoNumero: certificadoCalidad.numeroCorrelativo,
          proveedor: certificadoCalidad.proveedor,
        })
        .from(cicloMateriaPrima)
        .innerJoin(materiaPrima, eq(cicloMateriaPrima.materiaPrimaId, materiaPrima.id))
        .leftJoin(loteMp, eq(cicloMateriaPrima.loteMpId, loteMp.id))
        .leftJoin(certificadoCalidad, eq(loteMp.certificadoId, certificadoCalidad.id))
        .where(inArray(cicloMateriaPrima.cicloId, cicloIds))
    : [];
  return partidas.map((p) => {
    const susCiclos = ciclos.filter((c) => c.partidaId === p.partidaId);
    return {
      partidaId: p.partidaId,
      numero: p.numero,
      productoCodigo: p.productoCodigo,
      productoDescripcion: p.productoDescripcion,
      fechaApertura: p.fechaApertura,
      fechaCierre: p.fechaCierre,
      ciclos: susCiclos.map((c) => ({ id: c.id, fechaInicio: c.fechaInicio, inyectora: c.inyectora, piezasEntregadas: c.piezasEntregadas })),
      materiales: materiales
        .filter((m) => susCiclos.some((c) => c.id === m.cicloId))
        .map((m) => ({
          ...m,
          kg: Number(m.kg),
          codigoUso: m.loteCodigo && p.productoNumero ? codigoDeUso(m.loteCodigo, p.productoNumero) : null,
        })),
    };
  });
}

export type Destino = {
  cajaId: number | null;
  cajaCodigo: string | null;
  partidaId: number | null;
  partidaNumero: number | null;
  productoCodigo: string | null;
  unidades: number;
  despachoId: number;
  remitoInterno: string;
  remitoLegal: string | null;
  entregadoEn: Date | null;
  pedidoId: number;
  clienteId: number;
  clienteNombre: string;
};

/** Hacia adelante: lo que efectivamente salió (control final de despachos entregados). */
async function salidas(condicion: ReturnType<typeof and>): Promise<Destino[]> {
  const filas = await db
    .select({
      cajaId: caja.id,
      cajaCodigo: caja.codigoBarra,
      partidaId: partida.id,
      partidaNumero: partida.numero,
      productoCodigo: producto.codigo,
      unidades: piqueo.cantidad,
      despachoId: despacho.id,
      numeroInterno: despacho.numeroInterno,
      remitoLegal: despacho.numeroRemito,
      entregadoEn: despacho.entregadoEn,
      pedidoId: pedido.id,
      clienteId: cliente.id,
      clienteNombre: cliente.nombre,
    })
    .from(piqueo)
    .innerJoin(despacho, eq(piqueo.despachoId, despacho.id))
    .innerJoin(pedido, eq(despacho.pedidoId, pedido.id))
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .leftJoin(caja, eq(piqueo.cajaId, caja.id))
    .leftJoin(partida, eq(caja.partidaId, partida.id))
    .leftJoin(pedidoLinea, eq(piqueo.pedidoLineaId, pedidoLinea.id))
    .leftJoin(producto, eq(pedidoLinea.productoId, producto.id))
    .where(and(eq(piqueo.tipo, "CONTROL_FINAL"), eq(piqueo.conAlerta, false), eq(despacho.estado, "ENTREGADO"), condicion))
    .orderBy(asc(despacho.entregadoEn), asc(piqueo.id));
  return filas.map(({ numeroInterno, ...f }) => ({ ...f, remitoInterno: remitoInterno(numeroInterno) }));
}

async function cajasDePartidas(partidaIds: number[]) {
  if (partidaIds.length === 0) return [];
  return db
    .select({ id: caja.id, codigo: caja.codigoBarra, partidaId: caja.partidaId, cantidad: caja.cantidad, estado: caja.estado, fecha: caja.fecha })
    .from(caja)
    .where(inArray(caja.partidaId, partidaIds))
    .orderBy(asc(caja.numeroCaja));
}

// ---------------------------------------------------------------------------
// Puntos de partida de la búsqueda
// ---------------------------------------------------------------------------

/** Cliente / pedido → cajas → partidas → lotes → certificados. */
export async function trazarPedido(pedidoId: number) {
  const [cab] = await db
    .select({ id: pedido.id, fecha: pedido.fechaPedido, estado: pedido.estado, clienteId: cliente.id, clienteNombre: cliente.nombre })
    .from(pedido)
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .where(eq(pedido.id, pedidoId));
  if (!cab) return null;
  const destinos = await salidas(and(eq(pedido.id, pedidoId)));
  const origen = await origenDePartidas(destinos.map((d) => d.partidaId).filter((x): x is number => x != null));
  return { pedido: cab, entregas: destinos, origen, unidadesSinPartida: destinos.filter((d) => d.partidaId == null).reduce((s, d) => s + d.unidades, 0) };
}

export async function pedidosDeCliente(texto: string) {
  return db
    .select({ pedidoId: pedido.id, fecha: pedido.fechaPedido, estado: pedido.estado, clienteNombre: cliente.nombre })
    .from(pedido)
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .where(ilike(cliente.nombre, `%${texto.trim()}%`))
    .orderBy(sql`${pedido.fechaPedido} desc`)
    .limit(50);
}

export async function trazarPartida(numero: number) {
  const [p] = await db.select({ id: partida.id }).from(partida).where(eq(partida.numero, numero));
  if (!p) return null;
  const [origen] = await origenDePartidas([p.id]);
  const cajas = await cajasDePartidas([p.id]);
  const destinos = await salidas(and(eq(partida.id, p.id)));
  return { origen, cajas, destinos };
}

export async function trazarCaja(codigo: string) {
  const [c] = await db.select().from(caja).where(eq(caja.codigoBarra, codigo.trim().toUpperCase()));
  if (!c) return null;
  const [origen] = await origenDePartidas([c.partidaId]);
  const destinos = await salidas(and(eq(caja.id, c.id)));
  return { caja: c, origen, destinos };
}

/** Lote fallado → ciclos → partidas → cajas → clientes. */
export async function trazarLote(codigoOLote: string) {
  const valor = codigoOLote.replace(/\s+/g, "");
  const encontrados = await db
    .select({
      id: loteMp.id,
      codigoBarra: loteMp.codigoBarra,
      numeroLote: loteMp.numeroLote,
      fechaIngreso: loteMp.fechaIngreso,
      cantidadIngresada: loteMp.cantidadIngresada,
      materiaPrimaNombre: materiaPrima.nombre,
      certificadoNumero: certificadoCalidad.numeroCorrelativo,
      proveedor: certificadoCalidad.proveedor,
    })
    .from(loteMp)
    .innerJoin(materiaPrima, eq(loteMp.materiaPrimaId, materiaPrima.id))
    .leftJoin(certificadoCalidad, eq(loteMp.certificadoId, certificadoCalidad.id))
    .where(sql`${loteMp.codigoBarra} = ${valor} or ${loteMp.numeroLote} = ${valor}`);
  // El código de 27 dígitos es único; el número de lote solo, no (dos
  // proveedores pueden repetirlo): en ese caso no se elige uno al azar.
  const l = encontrados.find((e) => e.codigoBarra === valor) ?? (encontrados.length === 1 ? encontrados[0] : null);
  if (!l) return null;
  const usos = await db
    .select({ cicloId: cicloMateriaPrima.cicloId, kg: cicloMateriaPrima.cantidadKg, partidaId: cicloProduccion.partidaId })
    .from(cicloMateriaPrima)
    .innerJoin(cicloProduccion, eq(cicloMateriaPrima.cicloId, cicloProduccion.id))
    .where(eq(cicloMateriaPrima.loteMpId, l.id));
  const partidaIds = [...new Set(usos.map((u) => u.partidaId).filter((x): x is number => x != null))];
  const [origen, cajas, destinos] = await Promise.all([
    origenDePartidas(partidaIds),
    cajasDePartidas(partidaIds),
    partidaIds.length ? salidas(and(inArray(partida.id, partidaIds))) : Promise.resolve([] as Destino[]),
  ]);
  return { lote: l, usos: usos.map((u) => ({ ...u, kg: Number(u.kg) })), partidas: origen, cajas, destinos };
}

/** Lotes que comparten el número buscado (para pedir el código completo). */
export async function lotesConNumero(numeroLote: string) {
  return db
    .select({ codigoBarra: loteMp.codigoBarra, materiaPrimaNombre: materiaPrima.nombre })
    .from(loteMp)
    .innerJoin(materiaPrima, eq(loteMp.materiaPrimaId, materiaPrima.id))
    .where(eq(loteMp.numeroLote, numeroLote.replace(/\s+/g, "")));
}

export async function trazarCertificado(numero: number) {
  const [c] = await db
    .select({ id: certificadoCalidad.id, numero: certificadoCalidad.numeroCorrelativo, proveedor: certificadoCalidad.proveedor, fechaRecepcion: certificadoCalidad.fechaRecepcion, archivoUrl: certificadoCalidad.archivoUrl, materiaPrimaNombre: materiaPrima.nombre })
    .from(certificadoCalidad)
    .innerJoin(materiaPrima, eq(certificadoCalidad.materiaPrimaId, materiaPrima.id))
    .where(eq(certificadoCalidad.numeroCorrelativo, numero));
  if (!c) return null;
  const lotes = await db
    .select({ id: loteMp.id, codigoBarra: loteMp.codigoBarra, numeroLote: loteMp.numeroLote })
    .from(loteMp)
    .where(eq(loteMp.certificadoId, c.id));
  const trazas = await Promise.all(lotes.map((l) => trazarLote(l.codigoBarra)));
  return { certificado: c, lotes: trazas.filter((t): t is NonNullable<typeof t> => t != null) };
}
