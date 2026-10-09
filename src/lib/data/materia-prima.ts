/**
 * Materia prima con trazabilidad por lote (R4).
 *
 * - Ingreso: certificado de calidad del proveedor (numerado "correlativamente
 *   según orden de llegada") + lote + movimiento de ENTRADA.
 * - Código de barras del lote: 3 dígitos de producto + 4 de materia prima +
 *   8 de proveedor y certificado + 12 de lote. Definiciones pendientes,
 *   respuesta 9: "en el caso de materia prima los 3 primeros dígitos
 *   permanecen en 0 y se agregan al momento del inyectado cuando se decide el
 *   producto". Por eso el lote se guarda con "000…" y el código completo de
 *   uso (producto + resto) se arma al vincular el retiro con un ciclo.
 * - Retiro a máquina (formulario FN°10/2): movimiento de SALIDA y, si se
 *   indica el ciclo, el vínculo lote → ciclo → partida (`ciclo_materia_prima`).
 *
 * El stock de materia prima importado del Excel no tiene lote: se puede
 * retirar igual, y en la trazabilidad figura como "stock sin lote".
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  certificadoCalidad,
  cicloProduccion,
  loteMp,
  materiaPrima,
  movimiento,
  partida,
  producto,
  retiroMp,
  saldo,
  usuario,
} from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { puedeIngresarMateriaPrima } from "@/lib/auth/permisos";
import type { Actor, Resultado } from "@/lib/data/auditoria";
import { disponibleDeLotes, registrarRetiroMaquina } from "@/lib/data/maquina";

export type BloquesCodigo = { producto: string; materiaPrima: string; proveedorCertificado: string; lote: string };

/** Valida y separa el código de 27 dígitos del procedimiento. */
export function separarCodigoLote(codigo: string): BloquesCodigo | { error: string } {
  const c = codigo.replace(/\s+/g, "");
  if (!/^\d{27}$/.test(c)) return { error: "El código de barras del lote tiene que tener 27 dígitos (3 + 4 + 8 + 12)." };
  return { producto: c.slice(0, 3), materiaPrima: c.slice(3, 7), proveedorCertificado: c.slice(7, 15), lote: c.slice(15) };
}

/** Código de uso: los 3 primeros dígitos pasan a ser el número del producto inyectado. */
export function codigoDeUso(codigoLote: string, numeroProducto: string): string {
  return `${numeroProducto.padStart(3, "0").slice(-3)}${codigoLote.slice(3)}`;
}

export type IngresoMpInput = {
  materiaPrimaId: number;
  proveedor: string;
  fechaRecepcion: string;
  cantidadKg: number;
  codigoBarra: string;
  conCertificado: boolean;
  archivoUrl?: string | null;
  ubicacion?: string | null;
};

export async function ingresarMateriaPrima(actor: Actor, input: IngresoMpInput): Promise<Resultado & { loteId?: number; certificado?: number }> {
  if (!puedeIngresarMateriaPrima(actor.rol)) return { error: "No tenés permiso para ingresar materia prima." };
  if (!Number.isFinite(input.cantidadKg) || input.cantidadKg <= 0) return { error: "La cantidad tiene que ser mayor que cero." };
  if (!input.proveedor.trim()) return { error: "Falta el proveedor." };
  if (!input.fechaRecepcion) return { error: "Falta la fecha de recepción." };
  const bloques = separarCodigoLote(input.codigoBarra);
  if ("error" in bloques) return { error: bloques.error };
  if (bloques.producto !== "000") {
    return { error: "En el ingreso, los 3 primeros dígitos del código van en 0: el producto se define al inyectar." };
  }
  const codigo = input.codigoBarra.replace(/\s+/g, "");
  const depositoId = await getDepositoNexaId();

  return db.transaction(async (tx) => {
    const [mp] = await tx.select().from(materiaPrima).where(eq(materiaPrima.id, input.materiaPrimaId));
    if (!mp) return { error: "Materia prima no encontrada." };
    const [ya] = await tx.select({ id: loteMp.id }).from(loteMp).where(eq(loteMp.codigoBarra, codigo));
    if (ya) return { error: "Ya existe un lote con ese código de barras." };

    let certificadoId: number | null = null;
    let numeroCertificado: number | undefined;
    if (input.conCertificado) {
      const [{ max }] = await tx
        .select({ max: sql<number>`coalesce(max(${certificadoCalidad.numeroCorrelativo}), 0)`.mapWith(Number) })
        .from(certificadoCalidad);
      const [cert] = await tx
        .insert(certificadoCalidad)
        .values({
          numeroCorrelativo: max + 1,
          proveedor: input.proveedor.trim(),
          materiaPrimaId: mp.id,
          fechaRecepcion: input.fechaRecepcion,
          archivoUrl: input.archivoUrl?.trim() || null,
          usuarioId: actor.id,
        })
        .returning();
      certificadoId = cert.id;
      numeroCertificado = cert.numeroCorrelativo;
    }

    const [lote] = await tx
      .insert(loteMp)
      .values({
        materiaPrimaId: mp.id,
        certificadoId,
        numeroLote: bloques.lote,
        codigoBarra: codigo,
        fechaIngreso: input.fechaRecepcion,
        cantidadIngresada: String(input.cantidadKg),
        ubicacion: input.ubicacion?.trim() || null,
      })
      .returning();

    await tx.insert(movimiento).values({
      tipo: "ENTRADA",
      depositoId,
      materiaPrimaId: mp.id,
      loteMpId: lote.id,
      cantidad: String(input.cantidadKg),
      origen: "INGRESO_MP",
      origenId: lote.id,
      motivo: `Ingreso lote ${bloques.lote}${numeroCertificado ? ` · certificado N° ${numeroCertificado}` : ""} · ${input.proveedor.trim()}`,
      usuarioId: actor.id,
    });
    await tx
      .insert(saldo)
      .values({ depositoId, materiaPrimaId: mp.id, cantidad: String(input.cantidadKg) })
      .onConflictDoUpdate({ target: [saldo.depositoId, saldo.materiaPrimaId], set: { cantidad: sql`${saldo.cantidad} + ${input.cantidadKg}` } });
    return { loteId: lote.id, certificado: numeroCertificado };
  });
}

/** Lotes con su saldo disponible (ingresado − retirado). */
export async function listarLotes(filtro?: { materiaPrimaId?: number; soloConSaldo?: boolean }) {
  const filas = await db
    .select({
      id: loteMp.id,
      codigoBarra: loteMp.codigoBarra,
      numeroLote: loteMp.numeroLote,
      fechaIngreso: loteMp.fechaIngreso,
      ingresado: loteMp.cantidadIngresada,
      ubicacion: loteMp.ubicacion,
      materiaPrimaId: materiaPrima.id,
      materiaPrimaNombre: materiaPrima.nombre,
      certificadoNumero: certificadoCalidad.numeroCorrelativo,
      proveedor: certificadoCalidad.proveedor,
    })
    .from(loteMp)
    .innerJoin(materiaPrima, eq(loteMp.materiaPrimaId, materiaPrima.id))
    .leftJoin(certificadoCalidad, eq(loteMp.certificadoId, certificadoCalidad.id))
    .where(filtro?.materiaPrimaId ? eq(loteMp.materiaPrimaId, filtro.materiaPrimaId) : undefined)
    .orderBy(asc(loteMp.fechaIngreso), asc(loteMp.id));
  const disponibles = await disponibleDeLotes(db, filas.map((f) => f.id));
  const lotes = filas.map((f) => ({ ...f, disponible: disponibles.get(f.id) ?? Number(f.ingresado) }));
  return filtro?.soloConSaldo ? lotes.filter((l) => l.disponible > 0) : lotes;
}

export type RetiroInput = {
  materiaPrimaId: number;
  loteMpId: number | null;
  cantidadKg: number;
  inyectora: string | null;
  cicloId: number | null;
  entregaId: number | null;
  observaciones: string | null;
  fecha?: string;
};

/**
 * Retiro de una sola materia prima: crea un retiro a pie de máquina con una
 * línea (misma lógica que el formulario completo, src/lib/data/maquina.ts).
 * Devuelve el id de la línea por compatibilidad.
 */
export async function retirarMateriaPrima(actor: Actor, input: RetiroInput): Promise<Resultado & { id?: number; retiroMaquinaId?: number }> {
  const r = await registrarRetiroMaquina(actor, {
    cicloId: input.cicloId,
    inyectora: input.inyectora,
    entregaId: input.entregaId,
    observaciones: input.observaciones,
    fecha: input.fecha,
    lineas: [{ materiaPrimaId: input.materiaPrimaId, loteMpId: input.loteMpId, cantidadKg: input.cantidadKg }],
  });
  if (r.error) return { error: r.error };
  return { id: r.lineaIds![0], retiroMaquinaId: r.id };
}

export async function listarRetiros(filtro?: { cicloId?: number; limite?: number }) {
  return db
    .select({
      id: retiroMp.id,
      fecha: retiroMp.fecha,
      cantidad: retiroMp.cantidad,
      inyectora: retiroMp.inyectora,
      cicloId: retiroMp.cicloId,
      retiroMaquinaId: retiroMp.retiroMaquinaId,
      anulado: retiroMp.anulado,
      materiaPrimaNombre: materiaPrima.nombre,
      loteCodigo: loteMp.codigoBarra,
      numeroLote: loteMp.numeroLote,
      productoNumero: producto.numero,
      productoCodigo: producto.codigo,
      partidaNumero: partida.numero,
      retiraNombre: usuario.nombre,
    })
    .from(retiroMp)
    .innerJoin(materiaPrima, eq(retiroMp.materiaPrimaId, materiaPrima.id))
    .innerJoin(usuario, eq(retiroMp.retiraId, usuario.id))
    .leftJoin(loteMp, eq(retiroMp.loteMpId, loteMp.id))
    .leftJoin(cicloProduccion, eq(retiroMp.cicloId, cicloProduccion.id))
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .leftJoin(partida, eq(cicloProduccion.partidaId, partida.id))
    .where(filtro?.cicloId ? eq(retiroMp.cicloId, filtro.cicloId) : undefined)
    .orderBy(desc(retiroMp.creadoEn), desc(retiroMp.id))
    .limit(filtro?.limite ?? 100);
}

export async function materiasPrimasActivas() {
  return db
    .select({ id: materiaPrima.id, nombre: materiaPrima.nombre, tipo: materiaPrima.tipo })
    .from(materiaPrima)
    .where(eq(materiaPrima.activo, true))
    .orderBy(asc(materiaPrima.tipo), asc(materiaPrima.id));
}

export async function ciclosParaRetiro() {
  return db
    .select({
      id: cicloProduccion.id,
      fechaInicio: cicloProduccion.fechaInicio,
      inyectora: cicloProduccion.inyectora,
      productoCodigo: producto.codigo,
      partidaNumero: partida.numero,
      cerrado: sql<boolean>`${cicloProduccion.fechaFin} is not null`,
    })
    .from(cicloProduccion)
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .leftJoin(partida, eq(cicloProduccion.partidaId, partida.id))
    .orderBy(desc(cicloProduccion.fechaInicio), desc(cicloProduccion.id))
    .limit(30);
}
