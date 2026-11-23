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
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { partidaNexaSql } from "@/lib/data/partida-sql";
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
  caja,
  parametro,
  color,
  movimientoMaquina,
  retiroMp,
  materiaPrima,
  tanda,
  eventoProduccion,
  turnoProduccion,
  deposito,
} from "@/lib/db/schema";
import { getDepositoNexaId, ubicacionesMp } from "@/lib/data/depositos";
import { ErrorStock, moverEnUbicacion, repartirProporcional } from "@/lib/data/ubicaciones";
import { materialComprometido, ordenPrioridad, type FilaComprometido } from "@/lib/data/pedidos";
import { unidadesPorCaja } from "@/lib/data/catalogo";
import { PARAMETROS } from "@/lib/data/parametros";
import { hoyISO } from "@/lib/format";
import { codigoEtiquetaCaja, partidaNexa } from "@/lib/codigo-nexa";
import { resolverInyectora } from "@/lib/inyectoras";
import { resolverDosificacion } from "@/lib/data/dosificacion";

/** Lista chica para el select del alta de ciclo — no la del catálogo completo,
 *  que trae stock/semáforo que acá no hace falta. */
export async function productosParaCiclo() {
  return db
    .select({
      id: producto.id,
      codigo: producto.codigo,
      descripcion: producto.descripcion,
      piezasPorGolpe: producto.piezasPorGolpe,
      esAccesorio: producto.esAccesorio,
    })
    .from(producto)
    .where(eq(producto.activo, true))
    .orderBy(asc(producto.codigo));
}

/** Partidas todavía abiertas de un producto — para continuar en vez de abrir
 *  una nueva cuando se sigue con el mismo color al día siguiente. */
export type ResumenParaCiclo = Awaited<ReturnType<typeof resumenParaCiclo>>;

/**
 * Todo lo que el alta de ciclo necesita mostrar al elegir el producto: qué se
 * produce (color, material base y master configurados), en qué partida
 * (continuar la abierta o la próxima, con su número automático) y para qué
 * (pendiente de los pedidos contra el stock actual).
 */
export async function resumenParaCiclo(productoId: number) {
  const [p] = await db
    .select({
      id: producto.id,
      esAccesorio: producto.esAccesorio,
      familia: producto.familia,
      colorId: producto.colorId,
      colorNombre: color.nombre,
      piezasPorGolpe: producto.piezasPorGolpe,
      minimo: producto.minimo,
      kgPorUnidad: producto.kgPorUnidad,
    })
    .from(producto)
    .leftJoin(color, eq(producto.colorId, color.id))
    .where(eq(producto.id, productoId));
  if (!p) return null;
  const depositoId = await getDepositoNexaId();
  const [abiertas, [{ maxNumero }], dosif, pedidos, [s]] = await Promise.all([
    partidasAbiertasDe(productoId),
    db
      .select({ maxNumero: sql<number>`coalesce(max(${partida.numero}), 0)`.mapWith(Number) })
      .from(partida)
      .where(eq(partida.anio, Number(hoyISO().slice(0, 4)))),
    p.familia ? resolverDosificacion(p.familia, p.colorId) : Promise.resolve(null),
    pedidosQueNecesitan(productoId),
    db.select({ cantidad: saldo.cantidad }).from(saldo).where(and(eq(saldo.depositoId, depositoId), eq(saldo.productoId, productoId))),
  ]);
  const partidas = await Promise.all(
    abiertas.map(async (a) => {
      const ultimo = await ultimoCicloDePartida(a.id);
      return { ...a, ultimoGolpesFin: ultimo?.golpesFin ?? null, ultimoCicloAbierto: ultimo ? ultimo.fechaFin == null : false };
    }),
  );
  const pendientePedidos = pedidos.reduce((t, x) => t + x.cantidad, 0);
  const stock = Number(s?.cantidad ?? 0);
  const faltaProducir = Math.max(0, pendientePedidos - stock);
  // Reposición: lo que falta para que, cubiertos los pedidos, quede el mínimo
  // configurado. Sin mínimo configurado no se calcula (no se inventa).
  const stockLibre = Math.max(0, stock - pendientePedidos);
  const reposicion = p.minimo != null && p.minimo > 0 ? Math.max(0, p.minimo - stockLibre) : null;
  return {
    esAccesorio: p.esAccesorio,
    familia: p.familia,
    colorNombre: p.colorNombre,
    piezasPorGolpe: p.piezasPorGolpe,
    material: dosif ? { nombre: dosif.materiaPrimaBaseNombre, gPorKgMp: dosif.gPorKgMp } : null,
    partidas,
    siguientePartida: maxNumero + 1,
    pedidos,
    pendientePedidos,
    stock,
    faltaProducir,
    minimo: p.minimo,
    reposicion,
    /** Necesidad de pedidos + reposición: la cantidad recomendada. */
    recomendado: faltaProducir + (reposicion ?? 0),
    kgPorUnidad: p.kgPorUnidad != null && Number(p.kgPorUnidad) > 0 ? Number(p.kgPorUnidad) : null,
  };
}

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
    .orderBy(desc(cicloProduccion.fechaInicio), desc(cicloProduccion.id))
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
  /** Cantidad que se decide inyectar (planificación). */
  cantidadDeseada?: number | null;
};

/** Alta del día — Paso 1 (inicio). Si no se elige una partida abierta para
 *  continuar, genera una nueva con número correlativo (nunca se tipea). */
export async function crearCiclo(input: NuevoCicloInput): Promise<{ id: number } | { error: string }> {
  return db.transaction(async (tx) => {
    const [prod] = await tx.select({ esAccesorio: producto.esAccesorio }).from(producto).where(eq(producto.id, input.productoId));
    if (!prod) return { error: "Producto no encontrado." };
    // Baldosas sólo en la inyectora 8; accesorios en una inyectora existente.
    const iny = resolverInyectora(prod.esAccesorio, input.inyectora);
    if ("error" in iny) return iny;
    if (input.cantidadDeseada != null && (!Number.isInteger(input.cantidadDeseada) || input.cantidadDeseada <= 0)) {
      return { error: "La cantidad de inyección deseada tiene que ser un número entero mayor que cero." };
    }

    let partidaId = input.partidaId;
    if (partidaId) {
      // Continuar una partida: tiene que ser del mismo producto y seguir abierta.
      const [p] = await tx.select().from(partida).where(eq(partida.id, partidaId));
      if (!p || p.productoId !== input.productoId) return { error: "La partida elegida no es de este producto." };
      if (p.fechaCierre) return { error: `La partida ${partidaNexa(p.anio, p.numero)} ya está cerrada.` };
      // La continuidad sale del cierre anterior (golpes de fin): tiene que estar cerrado.
      const [abierto] = await tx
        .select({ id: cicloProduccion.id })
        .from(cicloProduccion)
        .where(and(eq(cicloProduccion.partidaId, partidaId), isNull(cicloProduccion.fechaFin)));
      if (abierto) return { error: `La partida ${partidaNexa(p.anio, p.numero)} tiene la producción #${abierto.id} sin cerrar: cerrala antes de continuar.` };
    } else {
      // Correlativo dentro del año de la producción: con el año nuevo vuelve a
      // empezar (regla del cliente 30/10/2026). El bloqueo serializa dos
      // altas simultáneas para que no tomen el mismo número.
      const anio = Number(input.fecha.slice(0, 4));
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('partida'), ${anio})`);
      const [{ maxNumero }] = await tx
        .select({ maxNumero: sql<number>`coalesce(max(${partida.numero}), 0)`.mapWith(Number) })
        .from(partida)
        .where(eq(partida.anio, anio));
      const [nueva] = await tx
        .insert(partida)
        .values({ anio, numero: maxNumero + 1, productoId: input.productoId, fechaApertura: input.fecha })
        .returning();
      partidaId = nueva.id;
    }

    const [ciclo] = await tx
      .insert(cicloProduccion)
      .values({
        partidaId,
        productoId: input.productoId,
        inyectora: iny.inyectora,
        cantidadDeseada: input.cantidadDeseada ?? null,
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
  const yaCerrado = { error: "Esta producción ya está cerrada." };
  const ciclo = await db.query.cicloProduccion.findFirst({ where: eq(cicloProduccion.id, cicloId) });
  if (!ciclo) return { error: "Producción no encontrada." };
  if (ciclo.fechaFin) return yaCerrado;

  const piezasProducidas =
    input.golpesFin != null && ciclo.golpesInicio != null && ciclo.piezasPorGolpe != null
      ? (input.golpesFin - ciclo.golpesInicio) * ciclo.piezasPorGolpe
      : null;
  if (piezasProducidas != null && piezasProducidas < 0) return { error: "Los golpes de fin no pueden ser menores que los de inicio." };
  // Sin este dato no entra nada a stock ni se generan las cajas: no se acepta vacío.
  if (input.piezasEntregadas == null || !Number.isInteger(input.piezasEntregadas) || input.piezasEntregadas < 0) {
    return { error: "Indicá las piezas que pasan a stock (0 si no pasa ninguna)." };
  }
  if (piezasProducidas != null && input.piezasEntregadas > piezasProducidas) {
    return { error: `Las piezas a stock (${input.piezasEntregadas}) no pueden superar las producidas (${piezasProducidas}).` };
  }

  const depositoId = await getDepositoNexaId();
  const ub = await ubicacionesMp();
  const [part] = ciclo.partidaId
    ? await db.select({ numero: partidaNexaSql }).from(partida).where(eq(partida.id, ciclo.partidaId))
    : [];
  const numeroPartida = part?.numero ?? null;
  // Colada automática: "el recorrido hasta la pieza pesa siempre lo mismo"
  // (minuta 15/10). Sólo si el producto tiene configurada la colada por golpe.
  let coladaKg = input.coladaKg;
  if ((coladaKg == null || coladaKg === "") && ciclo.productoId != null && input.golpesFin != null && ciclo.golpesInicio != null) {
    const [prod] = await db.select({ colada: producto.coladaKgPorGolpe }).from(producto).where(eq(producto.id, ciclo.productoId));
    if (prod?.colada != null && Number(prod.colada) > 0) {
      coladaKg = String(Math.round((input.golpesFin - ciclo.golpesInicio) * Number(prod.colada) * 1000) / 1000);
    }
  }

  return db.transaction(async (tx) => {
    // El "abierto" se vuelve a comprobar dentro de la transacción y de forma
    // atómica: un doble envío no puede ingresar el stock ni las cajas dos veces.
    const cerrado = await tx
      .update(cicloProduccion)
      .set({
        fechaFin: new Date(),
        golpesFin: input.golpesFin,
        piezasProducidas,
        piezasDescartadas: input.piezasDescartadas,
        piezasEntregadas: input.piezasEntregadas,
        coladaKg,
        rebarbaKg: input.rebarbaKg,
        scrapKg: input.scrapKg,
        cambioCicloCausa: input.cambioCicloCausa,
        observaciones: input.observaciones,
      })
      .where(and(eq(cicloProduccion.id, cicloId), isNull(cicloProduccion.fechaFin)))
      .returning({ id: cicloProduccion.id });
    if (cerrado.length === 0) return yaCerrado;

    // Las cajas completas de cada turno ya entraron al cerrar el turno: al
    // terminar entra lo que falta, con la última caja incompleta.
    const ya = await piezasIngresadas(tx, cicloId);
    const aIngresar = (input.piezasEntregadas ?? 0) - ya;
    if (aIngresar < 0) throw new ErrorStock(`Ya entraron ${ya} piezas al stock en los cierres de turno: las piezas a stock no pueden ser menos.`);
    if (ciclo.productoId != null && aIngresar > 0) {
      await ingresarAStock(tx, { depositoId, productoId: ciclo.productoId, partidaId: ciclo.partidaId, cicloId, piezas: aIngresar, usuarioId: input.usuarioId, motivo: `Producción #${cicloId}${numeroPartida != null ? ` · partida ${numeroPartida}` : ""}` });
    }

    if (ciclo.productoId != null && ciclo.partidaId != null && aIngresar > 0) {
      await generarCajas(tx, {
        cicloId,
        partidaId: ciclo.partidaId,
        productoId: ciclo.productoId,
        piezas: aIngresar,
      });
    }

    if (input.cerrarPartida && ciclo.partidaId) {
      await tx.update(partida).set({ fechaCierre: hoyISO() }).where(eq(partida.id, ciclo.partidaId));
    }
    await registrarConsumo(tx, cicloId, ub.proceso, input.usuarioId);
    await tx.insert(eventoProduccion).values({ cicloId, tipo: "FINALIZACION", motivo: `Golpes ${input.golpesFin ?? "—"} · ${input.piezasEntregadas ?? 0} piezas a stock`, usuarioId: input.usuarioId });
    if (ciclo.tandaId) {
      await tx.update(tanda).set({ estado: "COMPLETADA", actualizadoEn: new Date() }).where(eq(tanda.id, ciclo.tandaId));
    }
    return {};
  }).catch((e) => {
    if (e instanceof ErrorStock) return { error: e.message };
    throw e;
  });
}

/**
 * Consumo real de la producción: lo cargado en tolva (con el circuito de
 * ubicaciones) menos lo que se bajó como sobrante sale de "Tolva / en
 * proceso". Es la única baja definitiva del material virgen y del master.
 */
async function registrarConsumo(tx: Tx, cicloId: number, procesoId: number, usuarioId: number) {
  const cargas = await tx
    .select({ mpId: retiroMp.materiaPrimaId, loteMpId: retiroMp.loteMpId, cantidad: movimientoMaquina.cantidad, nombre: materiaPrima.nombre })
    .from(movimientoMaquina)
    .innerJoin(retiroMp, eq(movimientoMaquina.retiroMpId, retiroMp.id))
    .innerJoin(materiaPrima, eq(retiroMp.materiaPrimaId, materiaPrima.id))
    .where(
      and(
        eq(movimientoMaquina.cicloId, cicloId),
        eq(movimientoMaquina.tipo, "CARGA_TOLVA"),
        eq(movimientoMaquina.anulado, false),
        sql`${movimientoMaquina.movimientoId} is not null`,
      ),
    );
  if (cargas.length === 0) return;
  // Lo bajado de la tolva como sobrante de esta producción, por material.
  const sobrante = await tx
    .select({ mpId: movimiento.materiaPrimaId, total: sql<number>`coalesce(sum(${movimiento.cantidad}), 0)`.mapWith(Number) })
    .from(movimiento)
    .innerJoin(movimientoMaquina, eq(movimiento.origenId, movimientoMaquina.id))
    .where(
      and(
        eq(movimiento.depositoId, procesoId),
        eq(movimiento.origen, "TRANSFORMACION"),
        eq(movimientoMaquina.tipo, "SOBRANTE"),
        eq(movimientoMaquina.cicloId, cicloId),
        eq(movimientoMaquina.anulado, false),
      ),
    )
    .groupBy(movimiento.materiaPrimaId);
  const porClave = new Map<string, { mpId: number; loteMpId: number | null; kg: number; nombre: string }>();
  for (const c of cargas) {
    const k = `${c.mpId}-${c.loteMpId ?? ""}`;
    const a = porClave.get(k) ?? { mpId: c.mpId, loteMpId: c.loteMpId, kg: 0, nombre: c.nombre };
    a.kg = Math.round((a.kg + Number(c.cantidad)) * 1000) / 1000;
    porClave.set(k, a);
  }
  const grupos = [...porClave.values()];
  for (const mpId of new Set(grupos.map((g) => g.mpId))) {
    const delMp = grupos.filter((g) => g.mpId === mpId);
    const cargado = delMp.reduce((t, g) => t + g.kg, 0);
    const bajado = Math.abs(sobrante.find((x) => x.mpId === mpId)?.total ?? 0);
    const consumo = Math.max(0, Math.round((cargado - bajado) * 1000) / 1000);
    if (consumo <= 0) continue;
    const partes = repartirProporcional(consumo, delMp.map((g) => g.kg));
    for (let i = 0; i < delMp.length; i++) {
      if (partes[i] <= 0) continue;
      await moverEnUbicacion(tx, {
        depositoId: procesoId,
        tipo: "SALIDA",
        mpId,
        loteMpId: delMp[i].loteMpId,
        delta: -partes[i],
        origen: "CONSUMO",
        origenId: cicloId,
        motivo: `Consumo de la producción #${cicloId}`,
        usuarioId,
        nombreMp: delMp[i].nombre,
        nombreUbicacion: "En la tolva",
      });
    }
  }
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** "P00012-C0003": partida 12, caja 3. Identificador interno de la caja para
 *  piquearla; el diseño de la etiqueta impresa queda fuera de esta etapa. */
/** Identificador interno único de la caja (la etiqueta lleva el código del
 *  cliente, que no distingue una caja de otra de la misma partida). */
export function codigoCaja(anio: number, partidaNumero: number, numeroCaja: number): string {
  return `P${anio % 10}${String(partidaNumero).padStart(6, "0")}-C${String(numeroCaja).padStart(4, "0")}`;
}

/**
 * Las piezas que entran a stock al cerrar el día quedan en cajas vinculadas a
 * la partida y al ciclo — el eslabón partida → caja → despacho → cliente.
 * Pisos: cajas cerradas de `unidades_por_caja_pisos` (o la excepción del
 * producto) y una caja abierta con el resto. Accesorios: no se embalan hasta
 * la venta (respuesta 4), quedan como un bulto sin embalar de la partida.
 */
/** Piezas de una producción que ya entraron al stock (cierres de turno). */
async function piezasIngresadas(tx: Tx, cicloId: number): Promise<number> {
  const [{ n }] = await tx
    .select({ n: sql<number>`coalesce(sum(${movimiento.cantidad}), 0)`.mapWith(Number) })
    .from(movimiento)
    .where(and(eq(movimiento.origen, "CICLO"), eq(movimiento.origenId, cicloId), eq(movimiento.tipo, "ENTRADA")));
  return n;
}

/** Entrada de piezas al stock de producto terminado, con su movimiento. */
async function ingresarAStock(tx: Tx, input: { depositoId: number; productoId: number; partidaId: number | null; cicloId: number; piezas: number; usuarioId: number; motivo: string }) {
  await tx.insert(movimiento).values({
    tipo: "ENTRADA",
    depositoId: input.depositoId,
    productoId: input.productoId,
    partidaId: input.partidaId,
    cantidad: String(input.piezas),
    origen: "CICLO",
    origenId: input.cicloId,
    motivo: input.motivo,
    usuarioId: input.usuarioId,
  });
  await tx
    .insert(saldo)
    .values({ depositoId: input.depositoId, productoId: input.productoId, cantidad: String(input.piezas) })
    .onConflictDoUpdate({ target: [saldo.depositoId, saldo.productoId], set: { cantidad: sql`${saldo.cantidad} + ${input.piezas}` } });
}

/**
 * Al cerrar un turno (reunión 10/11/2026): las cajas completas con las piezas
 * buenas acumuladas entran a stock y quedan listas para imprimir su etiqueta.
 * Lo que no completa una caja queda como caja abierta para el turno siguiente.
 * Los accesorios (sin piezas por caja) entran al terminar la producción.
 * Devuelve cuántas cajas se cerraron.
 */
export async function cerrarCajasDelTurno(tx: Tx, input: { cicloId: number; turnoId: number; usuarioId: number }): Promise<number> {
  const [c] = await tx.select().from(cicloProduccion).where(eq(cicloProduccion.id, input.cicloId));
  if (!c?.productoId || !c.partidaId) return 0;
  const [prod] = await tx.select({ esAccesorio: producto.esAccesorio, unidadesPorCaja: producto.unidadesPorCaja, kg: producto.kgPorUnidad }).from(producto).where(eq(producto.id, c.productoId));
  const [param] = await tx.select({ valor: parametro.valor }).from(parametro).where(eq(parametro.clave, PARAMETROS.UNIDADES_POR_CAJA_PISOS));
  const porCaja = unidadesPorCaja(prod, { unidades_por_caja_pisos: Number(param?.valor ?? 0) });
  if (!porCaja || porCaja <= 0) return 0;
  const kgPieza = prod.kg != null && Number(prod.kg) > 0 ? Number(prod.kg) : null;
  const turnos = await tx.select({ piezas: turnoProduccion.piezas, descarteKg: turnoProduccion.descarteKg }).from(turnoProduccion).where(and(eq(turnoProduccion.cicloId, c.id), eq(turnoProduccion.estado, "CERRADO")));
  const buenas = turnos.reduce((t, x) => t + Math.max(0, (x.piezas ?? 0) - (kgPieza ? Math.round(Number(x.descarteKg ?? 0) / kgPieza) : 0)), 0);
  const libres = buenas - (await piezasIngresadas(tx, c.id));
  const cajas = Math.floor(libres / porCaja);
  if (cajas <= 0) return 0;
  const [part] = await tx.select({ numero: partidaNexaSql }).from(partida).where(eq(partida.id, c.partidaId));
  await ingresarAStock(tx, {
    // Dentro de la transacción: nunca una consulta por fuera (se traba).
    depositoId: (await tx.select({ id: deposito.id }).from(deposito).where(eq(deposito.nombre, "NEXA")))[0].id,
    productoId: c.productoId,
    partidaId: c.partidaId,
    cicloId: c.id,
    piezas: cajas * porCaja,
    usuarioId: input.usuarioId,
    motivo: `Producción #${c.id} · cierre de turno · partida ${part?.numero ?? "—"} · ${cajas} cajas`,
  });
  await generarCajas(tx, { cicloId: c.id, partidaId: c.partidaId, productoId: c.productoId, piezas: cajas * porCaja, turnoId: input.turnoId });
  return cajas;
}

export async function generarCajas(tx: Tx, input: { cicloId: number; partidaId: number; productoId: number; piezas: number; turnoId?: number | null }) {
  const [prod] = await tx
    .select({ esAccesorio: producto.esAccesorio, unidadesPorCaja: producto.unidadesPorCaja, codigo: producto.codigo })
    .from(producto)
    .where(eq(producto.id, input.productoId));
  const [part] = await tx.select({ anio: partida.anio, numero: partida.numero }).from(partida).where(eq(partida.id, input.partidaId));
  const [param] = await tx.select({ valor: parametro.valor }).from(parametro).where(eq(parametro.clave, PARAMETROS.UNIDADES_POR_CAJA_PISOS));
  if (!param) throw new Error(`Falta el parámetro "${PARAMETROS.UNIDADES_POR_CAJA_PISOS}".`);
  const porCaja = unidadesPorCaja(prod, { unidades_por_caja_pisos: Number(param.valor) });

  const tandas: number[] = [];
  if (porCaja == null) {
    tandas.push(input.piezas);
  } else {
    for (let resto = input.piezas; resto > 0; resto -= porCaja) tandas.push(Math.min(porCaja, resto));
  }

  const [{ ultimo }] = await tx
    .select({ ultimo: sql<number>`coalesce(max(${caja.numeroCaja}), 0)`.mapWith(Number) })
    .from(caja)
    .where(eq(caja.partidaId, input.partidaId));
  const hoy = hoyISO();
  await tx.insert(caja).values(
    tandas.map((cantidad, i) => ({
      partidaId: input.partidaId,
      productoId: input.productoId,
      cicloId: input.cicloId,
      turnoId: input.turnoId ?? null,
      numeroCaja: ultimo + i + 1,
      cantidad,
      codigoBarra: codigoCaja(part.anio, part.numero, ultimo + i + 1),
      // Etiqueta corta: 001B-6000172-00022 (reunión 10/11/2026).
      codigoEtiqueta: codigoEtiquetaCaja(prod.codigo, part.anio, part.numero, cantidad),
      fecha: hoy,
    })),
  );
}

export type FilaCiclo = {
  id: number;
  fechaInicio: Date;
  fechaFin: Date | null;
  inyectora: string;
  productoCodigo: string | null;
  productoDescripcion: string | null;
  partidaNumero: string | null;
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
      partidaNumero: partidaNexaSql,
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
  productoFamilia: (typeof producto.$inferSelect)["familia"] | null;
  productoColorId: number | null;
  productoColorNombre: string | null;
  productoKgPorUnidad: string | null;
  partidaNumero: string | null;
  operarioNombre: string | null;
  pedidos: { pedidoId: number; clienteNombre: string; cantidadAsignada: number }[];
};

export async function obtenerCiclo(id: number): Promise<CicloConDetalle | null> {
  const [fila] = await db
    .select({
      ciclo: cicloProduccion,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
      productoFamilia: producto.familia,
      productoColorId: producto.colorId,
      productoColorNombre: color.nombre,
      productoKgPorUnidad: producto.kgPorUnidad,
      partidaNumero: partidaNexaSql,
      operarioNombre: usuario.nombre,
    })
    .from(cicloProduccion)
    .leftJoin(producto, eq(cicloProduccion.productoId, producto.id))
    .leftJoin(color, eq(producto.colorId, color.id))
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

  return { ...fila.ciclo, productoCodigo: fila.productoCodigo, productoDescripcion: fila.productoDescripcion, productoFamilia: fila.productoFamilia, productoColorId: fila.productoColorId, productoColorNombre: fila.productoColorNombre, productoKgPorUnidad: fila.productoKgPorUnidad, partidaNumero: fila.partidaNumero, operarioNombre: fila.operarioNombre, pedidos };
}

export type PedidoNecesitaProducto = {
  pedidoId: number;
  clienteNombre: string;
  fechaPedido: string;
  /** Fecha que ordena la cola: la de entrega comprometida, o la del pedido si no tiene. */
  fechaEfectiva: string;
  tieneFechaEntrega: boolean;
  /** 0 = automática por fecha; distinto de 0 = ajuste manual (ver NIVELES_PRIORIDAD). */
  prioridad: number;
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
      fechaEntregaPactada: pedido.fechaEntregaPactada,
      prioridad: pedido.prioridad,
      cantidad: sql<number>`${pedidoLinea.unidadesPedidas} - ${pedidoLinea.unidadesDespachadas}`.mapWith(Number),
    })
    .from(pedidoLinea)
    .innerJoin(pedido, eq(pedidoLinea.pedidoId, pedido.id))
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .where(
      and(
        eq(pedidoLinea.productoId, productoId),
        sql`${pedido.estado} not in ('ENTREGADO', 'CANCELADO')`,
        eq(pedido.archivado, false),
        sql`${pedidoLinea.unidadesPedidas} > ${pedidoLinea.unidadesDespachadas}`,
      ),
    )
    .orderBy(...ordenPrioridad);
  return filas.map(aPedidoNecesita);
}

function aPedidoNecesita(f: {
  pedidoId: number;
  clienteNombre: string;
  fechaPedido: string;
  fechaEntregaPactada: string | null;
  prioridad: number;
  cantidad: number;
}): PedidoNecesitaProducto {
  return {
    pedidoId: f.pedidoId,
    clienteNombre: f.clienteNombre,
    fechaPedido: f.fechaPedido,
    fechaEfectiva: f.fechaEntregaPactada ?? f.fechaPedido,
    tieneFechaEntrega: f.fechaEntregaPactada != null,
    prioridad: f.prioridad,
    cantidad: f.cantidad,
  };
}

export type FilaCola = FilaComprometido & { pedidos: PedidoNecesitaProducto[] };

/**
 * Cola de producción: qué falta producir y en qué orden. El orden lo dan los
 * pedidos que esperan cada producto — urgentes primero (excepción manual del
 * Encargado o Supervisor), después la fecha de entrega más próxima — y no el
 * volumen del faltante. Es la misma regla `ordenPrioridad` que usa el alta
 * de ciclo para sugerir qué pedidos cubre la tirada.
 */
export async function colaProduccion(): Promise<FilaCola[]> {
  const faltantes = (await materialComprometido()).filter((f) => f.faltaProducir > 0);
  if (faltantes.length === 0) return [];

  const filas = await db
    .select({
      productoId: pedidoLinea.productoId,
      pedidoId: pedido.id,
      clienteNombre: cliente.nombre,
      fechaPedido: pedido.fechaPedido,
      fechaEntregaPactada: pedido.fechaEntregaPactada,
      prioridad: pedido.prioridad,
      cantidad: sql<number>`${pedidoLinea.unidadesPedidas} - ${pedidoLinea.unidadesDespachadas}`.mapWith(Number),
    })
    .from(pedidoLinea)
    .innerJoin(pedido, eq(pedidoLinea.pedidoId, pedido.id))
    .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
    .where(
      and(
        inArray(pedidoLinea.productoId, faltantes.map((f) => f.productoId)),
        sql`${pedido.estado} not in ('ENTREGADO', 'CANCELADO')`,
        eq(pedido.archivado, false),
        sql`${pedidoLinea.unidadesPedidas} > ${pedidoLinea.unidadesDespachadas}`,
      ),
    )
    .orderBy(...ordenPrioridad);

  const porProducto = new Map<number, PedidoNecesitaProducto[]>();
  const posicion = new Map<number, number>();
  filas.forEach((f, i) => {
    const lista = porProducto.get(f.productoId!) ?? [];
    lista.push(aPedidoNecesita(f));
    porProducto.set(f.productoId!, lista);
    if (!posicion.has(f.productoId!)) posicion.set(f.productoId!, i);
  });

  return faltantes
    .map((f) => ({ ...f, pedidos: porProducto.get(f.productoId) ?? [] }))
    .sort((a, b) => (posicion.get(a.productoId) ?? Infinity) - (posicion.get(b.productoId) ?? Infinity));
}

/** Cajas que generó un ciclo al cerrarse, con su estado actual. */
export type EtiquetaCaja = {
  id: number;
  codigo: string;
  cantidad: number;
  productoCodigo: string;
  productoDescripcion: string;
  familia: string;
  tipo: string;
  colorNombre: string | null;
  partida: string | null;
  fecha: string;
  turno: string | null;
  operario: string | null;
};

/**
 * Datos de las etiquetas a imprimir (reunión 10/11/2026): por turno (las cajas
 * que cerró), por producción (todas, o con `ultimas` las del último turno y la
 * última caja incompleta) o cajas puntuales (reimpresión).
 */
export async function etiquetasDe(filtro: { turnoId?: number; cicloId?: number; ultimas?: boolean; cajaIds?: number[] }): Promise<EtiquetaCaja[]> {
  let cond;
  if (filtro.cajaIds?.length) cond = inArray(caja.id, filtro.cajaIds);
  else if (filtro.turnoId) cond = eq(caja.turnoId, filtro.turnoId);
  else if (filtro.cicloId && filtro.ultimas) {
    const [ult] = await db.select({ id: turnoProduccion.id }).from(turnoProduccion).where(eq(turnoProduccion.cicloId, filtro.cicloId)).orderBy(desc(turnoProduccion.inicio)).limit(1);
    cond = and(eq(caja.cicloId, filtro.cicloId), ult ? sql`(${caja.turnoId} = ${ult.id} or ${caja.turnoId} is null)` : undefined);
  } else if (filtro.cicloId) cond = eq(caja.cicloId, filtro.cicloId);
  else return [];
  const filas = await db
    .select({
      id: caja.id,
      codigo: sql<string>`coalesce(${caja.codigoEtiqueta}, ${caja.codigoBarra})`,
      cantidad: caja.cantidad,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
      familia: producto.familia,
      tipo: producto.tipo,
      colorNombre: color.nombre,
      partida: partidaNexaSql,
      fecha: caja.fecha,
      turno: turnoProduccion.turno,
      operario: sql<string | null>`coalesce(${turnoProduccion.operarioNombre}, ${usuario.nombre})`,
    })
    .from(caja)
    .innerJoin(producto, eq(caja.productoId, producto.id))
    .leftJoin(color, eq(producto.colorId, color.id))
    .innerJoin(partida, eq(caja.partidaId, partida.id))
    .leftJoin(turnoProduccion, eq(caja.turnoId, turnoProduccion.id))
    .leftJoin(usuario, eq(turnoProduccion.operarioId, usuario.id))
    .where(cond)
    .orderBy(asc(caja.numeroCaja));
  return filas;
}

/**
 * Menú «Etiquetas» (reunión 20/11/2026): las producciones con cajas, de la más
 * reciente a la más vieja, para imprimir o reimprimir sus etiquetas sin tener
 * que buscar la producción. Filtra por fecha de la caja y por texto (código,
 * descripción o color).
 */
export async function produccionesConCajas(filtro: { desde: string; hasta: string; texto?: string | null }) {
  const texto = filtro.texto?.trim().toLowerCase();
  const filas = await db
    .select({
      cicloId: caja.cicloId,
      inyectora: cicloProduccion.inyectora,
      fechaInicio: cicloProduccion.fechaInicio,
      fechaFin: cicloProduccion.fechaFin,
      productoCodigo: producto.codigo,
      productoDescripcion: producto.descripcion,
      colorNombre: color.nombre,
      colorHex: color.hex,
      partida: partidaNexaSql,
      cajas: sql<number>`count(*)`.mapWith(Number),
      piezas: sql<number>`coalesce(sum(${caja.cantidad}), 0)`.mapWith(Number),
      ultima: sql<string>`max(${caja.fecha})`,
    })
    .from(caja)
    .innerJoin(cicloProduccion, eq(caja.cicloId, cicloProduccion.id))
    .innerJoin(producto, eq(caja.productoId, producto.id))
    .leftJoin(color, eq(producto.colorId, color.id))
    .innerJoin(partida, eq(caja.partidaId, partida.id))
    .where(
      and(
        sql`${caja.fecha} between ${filtro.desde} and ${filtro.hasta}`,
        texto ? sql`lower(${producto.codigo} || ' ' || ${producto.descripcion} || ' ' || coalesce(${color.nombre}, '')) like ${`%${texto}%`}` : undefined,
      ),
    )
    .groupBy(caja.cicloId, cicloProduccion.id, producto.id, color.id, partida.id)
    .orderBy(desc(sql`max(${caja.fecha})`), desc(caja.cicloId));
  return filas.filter((f): f is typeof f & { cicloId: number } => f.cicloId != null);
}

export async function cajasDeCiclo(cicloId: number) {
  return db
    .select({ id: caja.id, codigo: sql<string>`coalesce(${caja.codigoEtiqueta}, ${caja.codigoBarra})`, cantidad: caja.cantidad, estado: caja.estado })
    .from(caja)
    .where(eq(caja.cicloId, cicloId))
    .orderBy(asc(caja.numeroCaja));
}
