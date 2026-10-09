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
} from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { materialComprometido, ordenPrioridad, type FilaComprometido } from "@/lib/data/pedidos";
import { unidadesPorCaja } from "@/lib/data/catalogo";
import { PARAMETROS } from "@/lib/data/parametros";
import { hoyISO } from "@/lib/format";
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
    db.select({ maxNumero: sql<number>`coalesce(max(${partida.numero}), 0)`.mapWith(Number) }).from(partida),
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
      if (p.fechaCierre) return { error: `La partida N° ${p.numero} ya está cerrada.` };
      // La continuidad sale del cierre anterior (golpes de fin): tiene que estar cerrado.
      const [abierto] = await tx
        .select({ id: cicloProduccion.id })
        .from(cicloProduccion)
        .where(and(eq(cicloProduccion.partidaId, partidaId), isNull(cicloProduccion.fechaFin)));
      if (abierto) return { error: `La partida N° ${p.numero} tiene el ciclo #${abierto.id} sin cerrar: cerralo antes de continuar.` };
    } else {
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
  const yaCerrado = { error: "Este ciclo ya está cerrado." };
  const ciclo = await db.query.cicloProduccion.findFirst({ where: eq(cicloProduccion.id, cicloId) });
  if (!ciclo) return { error: "Ciclo no encontrado." };
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
  const [part] = ciclo.partidaId
    ? await db.select({ numero: partida.numero }).from(partida).where(eq(partida.id, ciclo.partidaId))
    : [];
  const numeroPartida = part?.numero ?? null;

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
        coladaKg: input.coladaKg,
        rebarbaKg: input.rebarbaKg,
        scrapKg: input.scrapKg,
        cambioCicloCausa: input.cambioCicloCausa,
        observaciones: input.observaciones,
      })
      .where(and(eq(cicloProduccion.id, cicloId), isNull(cicloProduccion.fechaFin)))
      .returning({ id: cicloProduccion.id });
    if (cerrado.length === 0) return yaCerrado;

    if (ciclo.productoId != null && input.piezasEntregadas != null && input.piezasEntregadas > 0) {
      await tx.insert(movimiento).values({
        tipo: "ENTRADA",
        depositoId,
        productoId: ciclo.productoId,
        partidaId: ciclo.partidaId,
        cantidad: String(input.piezasEntregadas),
        origen: "CICLO",
        origenId: cicloId,
        motivo: `Ciclo #${cicloId}${numeroPartida != null ? ` · partida N° ${numeroPartida}` : ""}`,
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

    if (ciclo.productoId != null && ciclo.partidaId != null && input.piezasEntregadas != null && input.piezasEntregadas > 0) {
      await generarCajas(tx, {
        cicloId,
        partidaId: ciclo.partidaId,
        productoId: ciclo.productoId,
        piezas: input.piezasEntregadas,
      });
    }

    if (input.cerrarPartida && ciclo.partidaId) {
      await tx.update(partida).set({ fechaCierre: hoyISO() }).where(eq(partida.id, ciclo.partidaId));
    }
    return {};
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** "P00012-C0003": partida 12, caja 3. Identificador interno de la caja para
 *  piquearla; el diseño de la etiqueta impresa queda fuera de esta etapa. */
export function codigoCaja(partidaNumero: number, numeroCaja: number): string {
  return `P${String(partidaNumero).padStart(5, "0")}-C${String(numeroCaja).padStart(4, "0")}`;
}

/**
 * Las piezas que entran a stock al cerrar el día quedan en cajas vinculadas a
 * la partida y al ciclo — el eslabón partida → caja → despacho → cliente.
 * Pisos: cajas cerradas de `unidades_por_caja_pisos` (o la excepción del
 * producto) y una caja abierta con el resto. Accesorios: no se embalan hasta
 * la venta (respuesta 4), quedan como un bulto sin embalar de la partida.
 */
export async function generarCajas(tx: Tx, input: { cicloId: number; partidaId: number; productoId: number; piezas: number }) {
  const [prod] = await tx
    .select({ esAccesorio: producto.esAccesorio, unidadesPorCaja: producto.unidadesPorCaja })
    .from(producto)
    .where(eq(producto.id, input.productoId));
  const [part] = await tx.select({ numero: partida.numero }).from(partida).where(eq(partida.id, input.partidaId));
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
      numeroCaja: ultimo + i + 1,
      cantidad,
      codigoBarra: codigoCaja(part.numero, ultimo + i + 1),
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
  productoFamilia: (typeof producto.$inferSelect)["familia"] | null;
  productoColorId: number | null;
  productoColorNombre: string | null;
  productoKgPorUnidad: string | null;
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
      productoFamilia: producto.familia,
      productoColorId: producto.colorId,
      productoColorNombre: color.nombre,
      productoKgPorUnidad: producto.kgPorUnidad,
      partidaNumero: partida.numero,
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
export async function cajasDeCiclo(cicloId: number) {
  return db
    .select({ id: caja.id, codigo: caja.codigoBarra, cantidad: caja.cantidad, estado: caja.estado })
    .from(caja)
    .where(eq(caja.cicloId, cicloId))
    .orderBy(asc(caja.numeroCaja));
}
