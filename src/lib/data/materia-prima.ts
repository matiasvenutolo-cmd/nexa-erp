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
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  certificadoCalidad,
  cicloMateriaPrima,
  cicloProduccion,
  loteMp,
  materiaPrima,
  movimiento,
  producto,
  retiroMp,
  saldo,
  usuario,
} from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { puedeIngresarMateriaPrima, puedeRetirarMateriaPrima } from "@/lib/auth/permisos";
import type { Actor, Resultado } from "@/lib/data/auditoria";
import { hoyISO } from "@/lib/format";

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
      retirado: sql<string>`coalesce((select sum(${retiroMp.cantidad}) from ${retiroMp} where ${retiroMp.loteMpId} = ${loteMp.id}), 0)`,
    })
    .from(loteMp)
    .innerJoin(materiaPrima, eq(loteMp.materiaPrimaId, materiaPrima.id))
    .leftJoin(certificadoCalidad, eq(loteMp.certificadoId, certificadoCalidad.id))
    .where(filtro?.materiaPrimaId ? eq(loteMp.materiaPrimaId, filtro.materiaPrimaId) : undefined)
    .orderBy(asc(loteMp.fechaIngreso), asc(loteMp.id));
  const lotes = filas.map((f) => ({ ...f, disponible: Number(f.ingresado) - Number(f.retirado) }));
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

export async function retirarMateriaPrima(actor: Actor, input: RetiroInput): Promise<Resultado & { id?: number }> {
  if (!puedeRetirarMateriaPrima(actor.rol)) return { error: "No tenés permiso para retirar materia prima." };
  if (!Number.isFinite(input.cantidadKg) || input.cantidadKg <= 0) return { error: "La cantidad tiene que ser mayor que cero." };
  const depositoId = await getDepositoNexaId();

  return db.transaction(async (tx) => {
    const [mp] = await tx.select().from(materiaPrima).where(eq(materiaPrima.id, input.materiaPrimaId));
    if (!mp) return { error: "Materia prima no encontrada." };
    // Bloquea el saldo de esta MP: dos retiros simultáneos se serializan y el
    // segundo ve lo que retiró el primero (lote y stock).
    const [s] = await tx
      .select({ cantidad: saldo.cantidad })
      .from(saldo)
      .where(and(eq(saldo.depositoId, depositoId), eq(saldo.materiaPrimaId, mp.id)))
      .for("update");
    if (input.loteMpId != null) {
      const [lote] = await tx.select().from(loteMp).where(eq(loteMp.id, input.loteMpId));
      if (!lote || lote.materiaPrimaId !== mp.id) return { error: "El lote no corresponde a esa materia prima." };
      const [{ retirado }] = await tx
        .select({ retirado: sql<number>`coalesce(sum(${retiroMp.cantidad}), 0)`.mapWith(Number) })
        .from(retiroMp)
        .where(eq(retiroMp.loteMpId, lote.id));
      const disponible = Number(lote.cantidadIngresada) - retirado;
      if (input.cantidadKg > disponible + 1e-9) return { error: `El lote tiene ${disponible} kg disponibles.` };
    }
    if (input.cantidadKg > Number(s?.cantidad ?? 0) + 1e-9) return { error: `Hay ${Number(s?.cantidad ?? 0)} kg en stock de ${mp.nombre}.` };
    if (input.cicloId != null) {
      const [ciclo] = await tx.select({ id: cicloProduccion.id }).from(cicloProduccion).where(eq(cicloProduccion.id, input.cicloId));
      if (!ciclo) return { error: "El ciclo indicado no existe." };
    }

    const [retiro] = await tx
      .insert(retiroMp)
      .values({
        fecha: input.fecha ?? hoyISO(),
        materiaPrimaId: mp.id,
        loteMpId: input.loteMpId,
        cicloId: input.cicloId,
        cantidad: String(input.cantidadKg),
        inyectora: input.inyectora?.trim() || null,
        retiraId: actor.id,
        entregaId: input.entregaId,
        observaciones: input.observaciones?.trim() || null,
      })
      .returning();
    await tx.insert(movimiento).values({
      tipo: "SALIDA",
      depositoId,
      materiaPrimaId: mp.id,
      loteMpId: input.loteMpId,
      cantidad: String(input.cantidadKg),
      origen: "RETIRO_MP",
      origenId: retiro.id,
      motivo: `Retiro a máquina${input.inyectora ? ` ${input.inyectora}` : ""}${input.cicloId ? ` · ciclo #${input.cicloId}` : ""}`,
      usuarioId: actor.id,
    });
    await tx
      .update(saldo)
      .set({ cantidad: sql`${saldo.cantidad} - ${input.cantidadKg}` })
      .where(and(eq(saldo.depositoId, depositoId), eq(saldo.materiaPrimaId, mp.id)));
    if (input.cicloId != null) {
      await tx.insert(cicloMateriaPrima).values({
        cicloId: input.cicloId,
        loteMpId: input.loteMpId,
        materiaPrimaId: mp.id,
        cantidadKg: String(input.cantidadKg),
        esMaster: mp.tipo === "MASTER",
      });
    }
    return { id: retiro.id };
  });
}

export async function listarRetiros(filtro?: { cicloId?: number; limite?: number }) {
  return db
    .select({
      id: retiroMp.id,
      fecha: retiroMp.fecha,
      cantidad: retiroMp.cantidad,
      inyectora: retiroMp.inyectora,
      cicloId: retiroMp.cicloId,
      materiaPrimaNombre: materiaPrima.nombre,
      loteCodigo: loteMp.codigoBarra,
      numeroLote: loteMp.numeroLote,
      productoNumero: producto.numero,
      retiraNombre: usuario.nombre,
    })
    .from(retiroMp)
    .innerJoin(materiaPrima, eq(retiroMp.materiaPrimaId, materiaPrima.id))
    .innerJoin(usuario, eq(retiroMp.retiraId, usuario.id))
    .leftJoin(loteMp, eq(retiroMp.loteMpId, loteMp.id))
    .leftJoin(cicloProduccion, eq(retiroMp.cicloId, cicloProduccion.id))
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
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
      cerrado: sql<boolean>`${cicloProduccion.fechaFin} is not null`,
    })
    .from(cicloProduccion)
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .orderBy(desc(cicloProduccion.fechaInicio), desc(cicloProduccion.id))
    .limit(30);
}
