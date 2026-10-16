/**
 * Pantalla del operario y relevo de turno (minuta 15/10/2026).
 *
 * El operario abre el celular y ve sólo lo de su máquina: qué producir, cuánto
 * falta, la receta en bolsas, el material a pie de máquina y en tolva. Ejecuta
 * la receta con un toque (el sistema calcula los kg y descuenta del pie de
 * máquina las líneas de retiro, primero las más viejas). Sólo escribe ante una
 * excepción, eligiendo el motivo de una lista.
 *
 * El turno es un corte intermedio: golpes al relevo, piezas y descarte del
 * turno, material que queda. El turno entrante ve el saldo heredado, verifica
 * el material y acepta el relevo o registra la diferencia. El cierre de la
 * producción (definitivo) sigue siendo otro paso.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  cicloProduccion,
  color,
  movimiento,
  movimientoMaquina,
  novedadMaquina,
  partida,
  presentacionMp,
  producto,
  retiroMp,
  materiaPrima,
  tanda,
  turnoProduccion,
  usuario,
} from "@/lib/db/schema";
import { puedeOperarTaller } from "@/lib/auth/permisos";
import type { Actor, Resultado } from "@/lib/data/auditoria";
import { ubicacionesMp } from "@/lib/data/depositos";
import { ErrorCarga, cargarEnTolvaTx, obtenerRetirosMaquina } from "@/lib/data/maquina";
import { cerrarCiclo } from "@/lib/data/produccion";
import { listarPresentaciones, presentacionesDe, recetasDe, type Receta } from "@/lib/data/recetas";
import { ErrorStock } from "@/lib/data/ubicaciones";
import { etiquetaTurno, type Turno } from "@/lib/data/planificacion";
import { INYECTORAS } from "@/lib/inyectoras";
import { aGramos, fmtPresentacion, kgDe } from "@/lib/presentaciones";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const EPS = 1e-6;

export const MOTIVOS_NO_CARGA = ["Máquina detenida o rota", "Cambio de matriz", "Falta de material a pie de máquina", "Cambio de color", "Otro"] as const;
export const MOTIVOS_EXCEPCION_CARGA = [
  "Arranque por cambio de color",
  "Carga parcial (tolva llena)",
  "Falta material a pie de máquina",
  "Ajuste de color pedido por el Encargado",
  "Otro",
] as const;
export const MOTIVOS_DIFERENCIA_RELEVO = ["Faltan bolsas", "Sobran bolsas", "Bolsa abierta o con otro peso", "Material de otro color o código", "Otro"] as const;
export const MOTIVOS_INTERRUPCION = ["Sin interrupciones", "Máquina detenida o rota", "Cambio de matriz", "Falta de material", "Corte de luz", "Otro"] as const;

/** Inyectora en número ("Inyectora 8" → "8"). */
const num = (iny: string) => iny.replace(/[^0-9]/g, "");
const sqlInyectora = (iny: string) => sql`regexp_replace(${cicloProduccion.inyectora}, '[^0-9]', '', 'g') = ${num(iny)}`;

/** Material por material, con su equivalente en bolsas cuando hay presentación. */
export type MaterialEnMaquina = { materiaPrimaId: number; nombre: string; esMaster: boolean; kg: number; bolsas: string | null };

function enBolsas(kg: number, pres: { nombre: string; kg: number }[]): string | null {
  // La presentación más grande que entra entera al menos una vez.
  const p = [...pres].sort((a, b) => b.kg - a.kg).find((x) => kg + EPS >= x.kg) ?? null;
  if (!p) return null;
  const cant = Math.floor((aGramos(kg) * 2) / aGramos(p.kg)) / 2;
  const resto = (aGramos(kg) - aGramos(kgDe(cant, p.kg))) / 1000;
  return `${fmtPresentacion(cant, p.nombre)}${resto > 0.0005 ? ` + ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 3 }).format(resto)} kg` : ""}`;
}

export type VistaTaller = Awaited<ReturnType<typeof vistaTaller>>;

/** Todo lo que necesita ver el operario de una inyectora. */
export async function vistaTaller(inyectora: string) {
  const iny = num(inyectora);
  const [prod] = await db
    .select({
      ciclo: cicloProduccion,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
      productoNumero: producto.numero,
      kgPorUnidad: producto.kgPorUnidad,
      colorNombre: color.nombre,
      partidaNumero: partida.numero,
    })
    .from(cicloProduccion)
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .leftJoin(color, eq(producto.colorId, color.id))
    .leftJoin(partida, eq(cicloProduccion.partidaId, partida.id))
    .where(and(isNull(cicloProduccion.fechaFin), sqlInyectora(iny)))
    .orderBy(desc(cicloProduccion.id))
    .limit(1);

  const presentaciones = await listarPresentaciones();
  const retiros = await obtenerRetirosMaquina({ estado: "ABIERTO", inyectora: iny });
  const pieMap = new Map<number, MaterialEnMaquina>();
  const mpTipos = new Map<number, string>();
  for (const r of retiros) {
    for (const l of r.lineas) {
      if (l.anulado || l.saldo.pie <= EPS) continue;
      mpTipos.set(l.materiaPrimaId, l.materiaPrimaTipo);
      const a = pieMap.get(l.materiaPrimaId) ?? { materiaPrimaId: l.materiaPrimaId, nombre: l.materiaPrimaNombre, esMaster: l.materiaPrimaTipo === "MASTER", kg: 0, bolsas: null };
      a.kg = (aGramos(a.kg) + aGramos(l.saldo.pie)) / 1000;
      pieMap.set(l.materiaPrimaId, a);
    }
  }
  const pie = [...pieMap.values()].map((m) => ({
    ...m,
    bolsas: enBolsas(m.kg, presentacionesDe(presentaciones, { id: m.materiaPrimaId, tipo: mpTipos.get(m.materiaPrimaId) ?? "" })),
  }));

  // Próxima tanda asignada a la máquina (si no hay producción en curso).
  const [proxima] = await db
    .select({ id: tanda.id, productoCodigo: producto.codigo, productoDescripcion: producto.descripcion, colorNombre: color.nombre, cantidad: sql<number>`${tanda.cantidadPedidos} + ${tanda.cantidadStock}`.mapWith(Number), fecha: tanda.fecha, turno: tanda.turno })
    .from(tanda)
    .innerJoin(producto, eq(tanda.productoId, producto.id))
    .leftJoin(color, eq(producto.colorId, color.id))
    .where(and(eq(tanda.estado, "PLANIFICADA"), eq(tanda.inyectora, iny)))
    .orderBy(asc(tanda.orden))
    .limit(1);

  if (!prod) return { inyectora: iny, produccion: null, pie, proxima: proxima ?? null } as const;

  const c = prod.ciclo;
  const [turnos, recetas, novedades, cargasTolva, sobrantes, tandaRow] = await Promise.all([
    db
      .select({ t: turnoProduccion, usuarioNombre: usuario.nombre })
      .from(turnoProduccion)
      .innerJoin(usuario, eq(turnoProduccion.operarioId, usuario.id))
      .where(eq(turnoProduccion.cicloId, c.id))
      .orderBy(asc(turnoProduccion.inicio)),
    c.productoId ? recetasDe([c.productoId]) : Promise.resolve(new Map<number, Partial<Record<"REGIMEN" | "ARRANQUE", Receta>>>()),
    db.select().from(novedadMaquina).where(eq(novedadMaquina.cicloId, c.id)).orderBy(desc(novedadMaquina.fecha)).limit(10),
    db
      .select({ mpId: retiroMp.materiaPrimaId, nombre: materiaPrima.nombre, tipo: materiaPrima.tipo, cantidad: movimientoMaquina.cantidad, turnoId: movimientoMaquina.turnoId, fecha: movimientoMaquina.fecha, motivo: movimientoMaquina.motivoExcepcion })
      .from(movimientoMaquina)
      .innerJoin(retiroMp, eq(movimientoMaquina.retiroMpId, retiroMp.id))
      .innerJoin(materiaPrima, eq(retiroMp.materiaPrimaId, materiaPrima.id))
      .where(and(eq(movimientoMaquina.cicloId, c.id), eq(movimientoMaquina.tipo, "CARGA_TOLVA"), eq(movimientoMaquina.anulado, false))),
    db
      .select({ mpId: movimiento.materiaPrimaId, total: sql<number>`coalesce(sum(${movimiento.cantidad}), 0)`.mapWith(Number) })
      .from(movimiento)
      .innerJoin(movimientoMaquina, eq(movimiento.origenId, movimientoMaquina.id))
      .where(and(eq(movimiento.origen, "TRANSFORMACION"), eq(movimientoMaquina.tipo, "SOBRANTE"), eq(movimientoMaquina.cicloId, c.id), sql`${movimiento.cantidad} < 0`))
      .groupBy(movimiento.materiaPrimaId),
    c.tandaId ? db.select().from(tanda).where(eq(tanda.id, c.tandaId)) : Promise.resolve([]),
  ]);
  const abierto = turnos.find((t) => t.t.estado === "ABIERTO") ?? null;
  const cerrados = turnos.filter((t) => t.t.estado === "CERRADO");
  const ultimo = cerrados.at(-1) ?? null;
  const producido = cerrados.reduce((t, x) => t + (x.t.piezas ?? 0), 0);
  const objetivo = c.cantidadDeseada ?? null;
  const r = c.productoId ? (recetas.get(c.productoId) ?? {}) : {};
  const hayCargas = cargasTolva.length > 0;
  const usarArranque = Boolean(tandaRow[0]?.usarArranque) && !hayCargas && Boolean(r.ARRANQUE);

  const tolvaMap = new Map<number, MaterialEnMaquina>();
  for (const x of cargasTolva) {
    const a = tolvaMap.get(x.mpId) ?? { materiaPrimaId: x.mpId, nombre: x.nombre, esMaster: x.tipo === "MASTER", kg: 0, bolsas: null };
    a.kg = (aGramos(a.kg) + aGramos(Number(x.cantidad))) / 1000;
    tolvaMap.set(x.mpId, a);
  }
  for (const sb of sobrantes) {
    const a = tolvaMap.get(sb.mpId!);
    if (a) a.kg = Math.max(0, (aGramos(a.kg) - aGramos(Math.abs(sb.total))) / 1000);
  }
  const cargasDelTurno = abierto ? cargasTolva.filter((x) => x.turnoId === abierto.t.id) : [];

  return {
    inyectora: iny,
    proxima: proxima ?? null,
    pie,
    produccion: {
      cicloId: c.id,
      productoId: c.productoId,
      productoCodigo: prod.productoCodigo,
      productoDescripcion: prod.productoDescripcion,
      productoNumero: prod.productoNumero,
      colorNombre: prod.colorNombre,
      partidaNumero: prod.partidaNumero,
      kgPorUnidad: prod.kgPorUnidad != null ? Number(prod.kgPorUnidad) : null,
      piezasPorGolpe: c.piezasPorGolpe ?? 1,
      golpesInicioProduccion: c.golpesInicio,
      objetivo,
      producido,
      falta: objetivo != null ? Math.max(0, objetivo - producido) : null,
      golpesFaltantes: objetivo != null ? Math.ceil(Math.max(0, objetivo - producido) / (c.piezasPorGolpe ?? 1)) : null,
      receta: r.REGIMEN ?? null,
      recetaArranque: r.ARRANQUE ?? null,
      usarArranque,
      tolva: [...tolvaMap.values()],
      turnoAbierto: abierto ? { ...abierto.t, usuarioNombre: abierto.usuarioNombre } : null,
      ultimoTurno: ultimo ? { ...ultimo.t, usuarioNombre: ultimo.usuarioNombre } : null,
      cargasDelTurno: cargasDelTurno.length,
      kgCargadosTurno: cargasDelTurno.reduce((t, x) => (aGramos(t) + aGramos(Number(x.cantidad))) / 1000, 0),
      novedades,
      descarteKg: c.descarteKg != null ? Number(c.descarteKg) : 0,
    },
  } as const;
}

/** Inyectoras con producción en curso o una tanda asignada (para elegir máquina). */
export async function inyectorasActivas(): Promise<{ inyectora: string; detalle: string }[]> {
  const enCurso = await db
    .select({ inyectora: cicloProduccion.inyectora, codigo: producto.codigo, colorNombre: color.nombre })
    .from(cicloProduccion)
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .leftJoin(color, eq(producto.colorId, color.id))
    .where(isNull(cicloProduccion.fechaFin));
  const asignadas = await db
    .select({ inyectora: tanda.inyectora, codigo: producto.codigo, colorNombre: color.nombre })
    .from(tanda)
    .innerJoin(producto, eq(tanda.productoId, producto.id))
    .leftJoin(color, eq(producto.colorId, color.id))
    .where(and(eq(tanda.estado, "PLANIFICADA"), sql`${tanda.inyectora} is not null`))
    .orderBy(asc(tanda.orden));
  const res = new Map<string, string>();
  for (const e of enCurso) res.set(num(e.inyectora), `En producción: ${e.codigo ?? ""} ${e.colorNombre ?? ""}`.trim());
  for (const a of asignadas) if (a.inyectora && !res.has(a.inyectora)) res.set(a.inyectora, `Próxima tanda: ${a.codigo} ${a.colorNombre ?? ""}`.trim());
  return INYECTORAS.filter((i) => res.has(i)).map((i) => ({ inyectora: i, detalle: res.get(i)! }));
}

async function cicloAbierto(tx: Tx | typeof db, cicloId: number) {
  const [c] = await tx.select().from(cicloProduccion).where(eq(cicloProduccion.id, cicloId));
  if (!c) return { error: "Producción no encontrada." } as const;
  if (c.fechaFin) return { error: "La producción ya está cerrada." } as const;
  return { c } as const;
}

// ---------------------------------------------------------------------------
// Turno: inicio con recepción del relevo
// ---------------------------------------------------------------------------

export type TomarTurnoInput = {
  cicloId: number;
  turno: Turno;
  operarioNombre?: string | null;
  golpesInicio?: number | null;
  /** Sólo si hay un turno anterior: el material recibido coincide. */
  recepcionOk?: boolean | null;
  recepcionMotivo?: string | null;
  recepcionDetalle?: string | null;
  token?: string | null;
};

export async function tomarTurno(actor: Actor, input: TomarTurnoInput): Promise<Resultado & { id?: number }> {
  if (!puedeOperarTaller(actor.rol)) return { error: "No tenés permiso para operar la máquina." };
  if (!["MANANA", "TARDE", "NOCHE"].includes(input.turno)) return { error: "Elegí el turno." };
  return db.transaction(async (tx) => {
    if (input.token) {
      const [ya] = await tx.select({ id: turnoProduccion.id }).from(turnoProduccion).where(eq(turnoProduccion.token, input.token));
      if (ya) return { id: ya.id };
    }
    const r = await cicloAbierto(tx, input.cicloId);
    if ("error" in r) return r;
    const { c } = r;
    // Una sola persona por máquina a la vez: bloquea la producción.
    await tx.select({ id: cicloProduccion.id }).from(cicloProduccion).where(eq(cicloProduccion.id, c.id)).for("update");
    const [abierto] = await tx.select().from(turnoProduccion).where(and(eq(turnoProduccion.cicloId, c.id), eq(turnoProduccion.estado, "ABIERTO")));
    if (abierto) return { error: `Hay un turno abierto (${etiquetaTurno(abierto.turno)}) en esta máquina: se cierra antes de tomar el siguiente.` };
    const [anterior] = await tx
      .select()
      .from(turnoProduccion)
      .where(and(eq(turnoProduccion.cicloId, c.id), eq(turnoProduccion.estado, "CERRADO")))
      .orderBy(desc(turnoProduccion.fin))
      .limit(1);
    if (anterior && input.recepcionOk == null) return { error: "Verificá el material que recibís y confirmá si coincide." };
    if (anterior && input.recepcionOk === false && !input.recepcionMotivo?.trim()) return { error: "Elegí el motivo de la diferencia en el material recibido." };
    const golpesInicio = input.golpesInicio ?? anterior?.golpesFin ?? c.golpesInicio ?? null;
    if (golpesInicio != null && (!Number.isInteger(golpesInicio) || golpesInicio < 0)) return { error: "Los golpes tienen que ser un número entero." };
    const [t] = await tx
      .insert(turnoProduccion)
      .values({
        cicloId: c.id,
        inyectora: num(c.inyectora),
        turno: input.turno,
        operarioId: actor.id,
        operarioNombre: input.operarioNombre?.trim() || null,
        golpesInicio,
        recepcionOk: anterior ? Boolean(input.recepcionOk) : null,
        recepcionMotivo: input.recepcionOk === false ? input.recepcionMotivo!.trim() : null,
        recepcionDetalle: input.recepcionDetalle?.trim() || null,
        token: input.token || null,
      })
      .returning();
    if (anterior && input.recepcionOk === false) {
      await tx.insert(novedadMaquina).values({
        cicloId: c.id,
        turnoId: t.id,
        inyectora: num(c.inyectora),
        tipo: "DIFERENCIA_RELEVO",
        motivo: input.recepcionMotivo!.trim(),
        detalle: input.recepcionDetalle?.trim() || null,
        usuarioId: actor.id,
      });
    }
    return { id: t.id };
  });
}

// ---------------------------------------------------------------------------
// Carga de la receta (un toque) o con excepción
// ---------------------------------------------------------------------------

export type CargarRecetaInput = {
  cicloId: number;
  tipo: "REGIMEN" | "ARRANQUE";
  /** Cantidades realmente cargadas, si difieren de la receta. */
  ajustes?: { materiaPrimaId: number; presentacionId: number; cantidad: number }[] | null;
  motivoExcepcion?: string | null;
  token?: string | null;
};

/**
 * Ejecuta la receta: por cada material, toma los kg del pie de máquina de esa
 * inyectora (líneas de retiro abiertas, primero las más viejas) y los pasa a
 * la tolva. Todo o nada: si falta material, no carga nada y lo explica.
 */
export async function cargarReceta(actor: Actor, input: CargarRecetaInput): Promise<Resultado & { kg?: number; repetido?: boolean }> {
  if (!puedeOperarTaller(actor.rol)) return { error: "No tenés permiso para operar la máquina." };
  const [c] = await db.select().from(cicloProduccion).where(eq(cicloProduccion.id, input.cicloId));
  if (!c || c.fechaFin) return { error: "No hay una producción en curso en esta máquina." };
  if (!c.productoId) return { error: "La producción no tiene producto." };
  const receta = (await recetasDe([c.productoId])).get(c.productoId)?.[input.tipo];
  if (!receta) return { error: input.tipo === "ARRANQUE" ? "Este producto no tiene receta de arranque." : "Este producto no tiene receta de carga: pedile al Encargado que la defina." };

  let items = receta.items.map((i) => ({ materiaPrimaId: i.materiaPrimaId, presentacionId: i.presentacionId, cantidad: i.cantidad, kgPres: i.kgPresentacion, nombre: i.materiaPrimaNombre, presNombre: i.presentacionNombre }));
  const planKg = new Map<number, number>();
  for (const i of receta.items) planKg.set(i.materiaPrimaId, (aGramos(planKg.get(i.materiaPrimaId) ?? 0) + aGramos(i.kg)) / 1000);
  let excepcion = false;
  if (input.ajustes && input.ajustes.length) {
    const pres = await db.select().from(presentacionMp).where(inArray(presentacionMp.id, input.ajustes.map((a) => a.presentacionId)));
    const mps = await db.select({ id: materiaPrima.id, nombre: materiaPrima.nombre }).from(materiaPrima).where(inArray(materiaPrima.id, input.ajustes.map((a) => a.materiaPrimaId)));
    for (const a of input.ajustes) {
      if (!Number.isFinite(a.cantidad) || a.cantidad < 0 || Math.abs(a.cantidad * 2 - Math.round(a.cantidad * 2)) > 1e-9) {
        return { error: "Las cantidades van en bolsas enteras o medias." };
      }
    }
    const nuevos = input.ajustes
      .filter((a) => a.cantidad > 0)
      .map((a) => {
        const p = pres.find((x) => x.id === a.presentacionId);
        return { materiaPrimaId: a.materiaPrimaId, presentacionId: a.presentacionId, cantidad: a.cantidad, kgPres: Number(p?.kg ?? 0), nombre: mps.find((m) => m.id === a.materiaPrimaId)?.nombre ?? "", presNombre: p?.nombre ?? "" };
      });
    const firma = (xs: { materiaPrimaId: number; presentacionId: number; cantidad: number }[]) =>
      xs
        .filter((x) => x.cantidad > 0)
        .map((x) => `${x.materiaPrimaId}:${x.presentacionId}:${x.cantidad}`)
        .sort()
        .join("|");
    excepcion = firma(nuevos) !== firma(items);
    if (excepcion && !input.motivoExcepcion?.trim()) return { error: "Cargaste distinto de la receta: elegí el motivo." };
    if (nuevos.some((n) => n.kgPres <= 0)) return { error: "Presentación inexistente." };
    items = nuevos;
  }
  if (items.length === 0) return { error: "No hay nada para cargar. Si no se pudo cargar, registrá el motivo con «No pude cargar»." };

  const ub = await ubicacionesMp();
  const motivo = excepcion ? input.motivoExcepcion!.trim() : null;
  // Líneas a pie de máquina de la inyectora: se leen antes de la transacción;
  // cada carga vuelve a bloquear y validar su línea adentro.
  const retiros = await obtenerRetirosMaquina({ estado: "ABIERTO", inyectora: num(c.inyectora) });
  return db
    .transaction(async (tx) => {
      if (input.token) {
        const [ya] = await tx.select({ id: movimientoMaquina.id }).from(movimientoMaquina).where(eq(movimientoMaquina.token, `${input.token}:0`));
        if (ya) return { repetido: true };
      }
      const [turno] = await tx.select().from(turnoProduccion).where(and(eq(turnoProduccion.cicloId, c.id), eq(turnoProduccion.estado, "ABIERTO")));
      if (!turno) throw new ErrorCarga("Tomá el turno antes de cargar la tolva.");
      // Agrupa por material (una receta puede tener dos presentaciones del mismo).
      const porMp = new Map<number, { kg: number; nombre: string }>();
      for (const i of items) {
        const a = porMp.get(i.materiaPrimaId) ?? { kg: 0, nombre: i.nombre };
        a.kg = (aGramos(a.kg) + aGramos(kgDe(i.cantidad, i.kgPres))) / 1000;
        porMp.set(i.materiaPrimaId, a);
      }
      let n = 0;
      let total = 0;
      for (const [mpId, { kg, nombre }] of porMp) {
        const lineas = retiros
          .slice()
          .sort((a, b) => a.id - b.id)
          .flatMap((r) => r.lineas)
          .filter((l) => l.materiaPrimaId === mpId && !l.anulado && l.saldo.pie > EPS);
        const hay = lineas.reduce((t, l) => (aGramos(t) + aGramos(l.saldo.pie)) / 1000, 0);
        if (kg > hay + EPS) {
          throw new ErrorCarga(
            `A pie de máquina hay ${new Intl.NumberFormat("es-AR").format(hay)} kg de ${nombre} y la carga pide ${new Intl.NumberFormat("es-AR").format(kg)} kg. Pedí el retiro del material, o cargá lo que hay indicando el motivo.`,
          );
        }
        let resta = kg;
        for (const l of lineas) {
          if (resta <= EPS) break;
          const toma = Math.min(resta, l.saldo.pie);
          await cargarEnTolvaTx(
            tx,
            actor,
            {
              retiroMpId: l.id,
              cantidadKg: Math.round(toma * 1000) / 1000,
              cicloId: c.id,
              turnoId: turno.id,
              token: input.token ? `${input.token}:${n}` : null,
              planificadoKg: excepcion ? (planKg.get(mpId) ?? 0) : null,
              motivoExcepcion: motivo,
              observaciones: excepcion ? null : `Receta ${input.tipo === "ARRANQUE" ? "de arranque" : "de régimen"}`,
            },
            ub,
          );
          n++;
          resta = (aGramos(resta) - aGramos(toma)) / 1000;
        }
        total = (aGramos(total) + aGramos(kg)) / 1000;
      }
      if (excepcion) {
        await tx.insert(novedadMaquina).values({
          cicloId: c.id,
          turnoId: turno.id,
          inyectora: num(c.inyectora),
          tipo: "CARGA_DISTINTA",
          motivo: motivo!,
          detalle: `Receta: ${receta.items.map((i) => `${i.texto} ${i.materiaPrimaNombre}`).join(" + ")} · Cargado: ${items.map((i) => `${fmtPresentacion(i.cantidad, i.presNombre)} ${i.nombre}`).join(" + ")}`,
          usuarioId: actor.id,
        });
      }
      return { kg: total };
    })
    .catch((e) => {
      if (e instanceof ErrorCarga || e instanceof ErrorStock) return { error: e.message };
      throw e;
    });
}

/** "No pude cargar" o una interrupción: queda para el Encargado y el turno siguiente. */
export async function registrarNovedad(
  actor: Actor,
  input: { cicloId: number; tipo: "NO_CARGA" | "INTERRUPCION"; motivo: string; detalle?: string | null },
): Promise<Resultado> {
  if (!puedeOperarTaller(actor.rol)) return { error: "No tenés permiso para operar la máquina." };
  if (!input.motivo?.trim()) return { error: "Elegí el motivo." };
  const r = await cicloAbierto(db, input.cicloId);
  if ("error" in r) return r;
  const [turno] = await db.select({ id: turnoProduccion.id }).from(turnoProduccion).where(and(eq(turnoProduccion.cicloId, r.c.id), eq(turnoProduccion.estado, "ABIERTO")));
  await db.insert(novedadMaquina).values({
    cicloId: r.c.id,
    turnoId: turno?.id ?? null,
    inyectora: num(r.c.inyectora),
    tipo: input.tipo,
    motivo: input.motivo.trim(),
    detalle: input.detalle?.trim() || null,
    usuarioId: actor.id,
  });
  return {};
}

// ---------------------------------------------------------------------------
// Cierre de turno (relevo) y cierre de producción
// ---------------------------------------------------------------------------

export type CerrarTurnoInput = { cicloId: number; golpesFin: number; descarteKg?: number | null; motivoInterrupcion?: string | null; observaciones?: string | null };

async function cerrarTurnoTx(tx: Tx, actor: Actor, input: CerrarTurnoInput) {
  const [c] = await tx.select().from(cicloProduccion).where(eq(cicloProduccion.id, input.cicloId)).for("update");
  if (!c || c.fechaFin) return { error: "La producción ya está cerrada." } as const;
  const [t] = await tx.select().from(turnoProduccion).where(and(eq(turnoProduccion.cicloId, c.id), eq(turnoProduccion.estado, "ABIERTO"))).for("update");
  if (!t) return { error: "No hay un turno abierto en esta máquina." } as const;
  if (!Number.isInteger(input.golpesFin) || input.golpesFin < 0) return { error: "Los golpes tienen que ser un número entero." } as const;
  if (t.golpesInicio != null && input.golpesFin < t.golpesInicio) {
    return { error: `Los golpes al cierre (${input.golpesFin}) no pueden ser menores que al inicio del turno (${t.golpesInicio}).` } as const;
  }
  const descarte = input.descarteKg ?? 0;
  if (!Number.isFinite(descarte) || descarte < 0 || descarte > 5000) return { error: "El descarte va en kilos (0 o más)." } as const;
  const piezas = t.golpesInicio != null ? (input.golpesFin - t.golpesInicio) * (c.piezasPorGolpe ?? 1) : null;
  const interrupcion = input.motivoInterrupcion && input.motivoInterrupcion !== "Sin interrupciones" ? input.motivoInterrupcion.trim() : null;
  await tx
    .update(turnoProduccion)
    .set({ estado: "CERRADO", fin: new Date(), golpesFin: input.golpesFin, piezas, descarteKg: String(descarte), motivoInterrupcion: interrupcion, observaciones: input.observaciones?.trim() || null, cerradoPorId: actor.id })
    .where(eq(turnoProduccion.id, t.id));
  await tx
    .update(cicloProduccion)
    .set({ descarteKg: sql`coalesce(${cicloProduccion.descarteKg}, 0) + ${descarte}` })
    .where(eq(cicloProduccion.id, c.id));
  if (interrupcion) {
    await tx.insert(novedadMaquina).values({ cicloId: c.id, turnoId: t.id, inyectora: num(c.inyectora), tipo: "INTERRUPCION", motivo: interrupcion, detalle: input.observaciones?.trim() || null, usuarioId: actor.id });
  }
  return { piezas } as const;
}

export async function cerrarTurno(actor: Actor, input: CerrarTurnoInput): Promise<Resultado & { piezas?: number | null }> {
  if (!puedeOperarTaller(actor.rol)) return { error: "No tenés permiso para operar la máquina." };
  const r = await db.transaction((tx) => cerrarTurnoTx(tx, actor, input));
  return "error" in r ? { error: r.error } : { piezas: r.piezas };
}

/**
 * Cierre definitivo de la producción desde la máquina: cierra el turno abierto
 * (si lo hay) y la producción. Piezas = golpes; descarte en piezas = kg de
 * descarte ÷ peso por pieza; entra a stock lo bueno. Rebarba y scrap en kg.
 */
export async function cerrarProduccionTaller(
  actor: Actor,
  input: { cicloId: number; golpesFin?: number | null; descarteKg?: number | null; rebarbaKg?: number | null; scrapKg?: number | null; cerrarPartida?: boolean; observaciones?: string | null },
): Promise<Resultado & { piezasAStock?: number }> {
  if (!puedeOperarTaller(actor.rol)) return { error: "No tenés permiso para operar la máquina." };
  const [c0] = await db.select().from(cicloProduccion).where(eq(cicloProduccion.id, input.cicloId));
  if (!c0 || c0.fechaFin) return { error: "La producción ya está cerrada." };
  const [abierto] = await db.select().from(turnoProduccion).where(and(eq(turnoProduccion.cicloId, c0.id), eq(turnoProduccion.estado, "ABIERTO")));
  if (abierto) {
    if (input.golpesFin == null) return { error: "Indicá los golpes de la máquina al terminar." };
    const r = await db.transaction((tx) => cerrarTurnoTx(tx, actor, { cicloId: c0.id, golpesFin: input.golpesFin!, descarteKg: input.descarteKg }));
    if ("error" in r) return { error: r.error };
  }
  const [c] = await db.select().from(cicloProduccion).where(eq(cicloProduccion.id, input.cicloId));
  const [ult] = await db
    .select({ golpesFin: turnoProduccion.golpesFin })
    .from(turnoProduccion)
    .where(and(eq(turnoProduccion.cicloId, c.id), eq(turnoProduccion.estado, "CERRADO")))
    .orderBy(desc(turnoProduccion.fin))
    .limit(1);
  const golpesFin = input.golpesFin ?? ult?.golpesFin ?? null;
  if (golpesFin == null) return { error: "Indicá los golpes de la máquina al terminar." };
  const [prod] = c.productoId ? await db.select({ kg: producto.kgPorUnidad }).from(producto).where(eq(producto.id, c.productoId)) : [];
  const kgPieza = prod?.kg != null && Number(prod.kg) > 0 ? Number(prod.kg) : null;
  const producidas = c.golpesInicio != null ? (golpesFin - c.golpesInicio) * (c.piezasPorGolpe ?? 1) : null;
  if (producidas == null) return { error: "La producción no tiene golpes de inicio: la cierra el Encargado desde Producción." };
  const descarteKg = Number(c.descarteKg ?? 0);
  if (descarteKg > 0 && !kgPieza) return { error: "El producto no tiene peso por pieza para convertir el descarte: la cierra el Encargado desde Producción." };
  const descartadas = kgPieza ? Math.min(producidas, Math.round(descarteKg / kgPieza)) : 0;
  const aStock = Math.max(0, producidas - descartadas);
  const r = await cerrarCiclo(c.id, {
    golpesFin,
    piezasDescartadas: descartadas,
    piezasEntregadas: aStock,
    coladaKg: null,
    rebarbaKg: input.rebarbaKg != null ? String(input.rebarbaKg) : null,
    scrapKg: input.scrapKg != null ? String(input.scrapKg) : null,
    cambioCicloCausa: null,
    observaciones: input.observaciones ?? null,
    cerrarPartida: Boolean(input.cerrarPartida),
    usuarioId: actor.id,
  });
  if (r.error) return r;
  return { piezasAStock: aStock };
}

/** Turnos y novedades recientes (para el Encargado y Materia prima). */
export async function relevosRecientes(limite = 30) {
  const turnos = await db
    .select({ t: turnoProduccion, usuarioNombre: usuario.nombre, productoCodigo: producto.codigo })
    .from(turnoProduccion)
    .innerJoin(usuario, eq(turnoProduccion.operarioId, usuario.id))
    .innerJoin(cicloProduccion, eq(turnoProduccion.cicloId, cicloProduccion.id))
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .orderBy(desc(turnoProduccion.inicio))
    .limit(limite);
  const novedades = await db
    .select({ n: novedadMaquina, usuarioNombre: usuario.nombre })
    .from(novedadMaquina)
    .innerJoin(usuario, eq(novedadMaquina.usuarioId, usuario.id))
    .orderBy(desc(novedadMaquina.fecha))
    .limit(limite);
  // Diferencias entre lo planificado (receta) y lo cargado.
  const excepciones = await db
    .select({
      id: movimientoMaquina.id,
      fecha: movimientoMaquina.fecha,
      cicloId: movimientoMaquina.cicloId,
      cantidad: movimientoMaquina.cantidad,
      planificado: movimientoMaquina.planificadoKg,
      motivo: movimientoMaquina.motivoExcepcion,
      mp: materiaPrima.nombre,
      usuarioNombre: usuario.nombre,
    })
    .from(movimientoMaquina)
    .innerJoin(usuario, eq(movimientoMaquina.usuarioId, usuario.id))
    .leftJoin(retiroMp, eq(movimientoMaquina.retiroMpId, retiroMp.id))
    .leftJoin(materiaPrima, eq(retiroMp.materiaPrimaId, materiaPrima.id))
    .where(and(sql`${movimientoMaquina.motivoExcepcion} is not null`, eq(movimientoMaquina.anulado, false)))
    .orderBy(desc(movimientoMaquina.fecha))
    .limit(limite);
  return { turnos, novedades, excepciones };
}
