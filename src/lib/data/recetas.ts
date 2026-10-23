/**
 * Recetas de carga en tolva (minuta 15/10/2026).
 *
 * La receta la define el Encargado por producto (familia + tipo + color) en
 * presentaciones físicas: "4 bolsas de 25 kg de copolímero + 2 bolsitas de
 * 600 g de master negro". El operario la ejecuta con un toque. Hay una receta
 * de RÉGIMEN y, opcionalmente, una de ARRANQUE reforzada para el cambio de
 * color.
 *
 * Las recetas NO se calculan desde la dosificación anterior en g/kg
 * (dosificacion_master): esa definición (0,015 g por kg) no coincide con las
 * cargas físicas documentadas en la planilla (100 kg de copolímero + 1,2 kg de
 * master negro = 12 g por kg). La discrepancia queda informada en
 * Configuración → Master y en docs/13; la fuente de verdad para la carga es
 * esta receta.
 */
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { materiaPrima, presentacionMp, producto, recetaCarga, recetaCargaItem, color } from "@/lib/db/schema";
import { puedeEditarRecetas } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";
import { aGramos, fmtPresentacion, kgDe } from "@/lib/presentaciones";

export type TipoReceta = "REGIMEN" | "ARRANQUE";

export type Presentacion = { id: number; nombre: string; kg: number; materiaPrimaId: number | null; tipoMp: string | null };

/** Presentaciones activas (generales por tipo y propias de cada material). */
export async function listarPresentaciones(): Promise<Presentacion[]> {
  const filas = await db.select().from(presentacionMp).where(eq(presentacionMp.activo, true)).orderBy(asc(presentacionMp.kg));
  return filas.map((p) => ({ id: p.id, nombre: p.nombre, kg: Number(p.kg), materiaPrimaId: p.materiaPrimaId, tipoMp: p.tipoMp }));
}

/** Las presentaciones que valen para un material: las propias y las de su tipo. */
export function presentacionesDe(todas: Presentacion[], mp: { id: number; tipo: string }): Presentacion[] {
  return todas.filter((p) => p.materiaPrimaId === mp.id || (p.materiaPrimaId == null && p.tipoMp === mp.tipo));
}

export async function crearPresentacion(
  actor: Actor,
  input: { nombre: string; kg: number; materiaPrimaId?: number | null; tipoMp?: "VIRGEN" | "MASTER" | "MOLIENDA" | "SOBRANTE" | null },
): Promise<Resultado & { id?: number }> {
  if (!puedeEditarRecetas(actor.rol)) return { error: "No tenés permiso para configurar presentaciones." };
  const nombre = input.nombre.trim();
  if (!nombre) return { error: "Poné un nombre a la presentación (por ejemplo «Bolsita 600 g»)." };
  if (!Number.isFinite(input.kg) || input.kg <= 0 || input.kg > 2000) return { error: "El peso de la presentación tiene que estar entre 1 g y 2.000 kg." };
  if (!input.materiaPrimaId && !input.tipoMp) return { error: "Indicá a qué material o tipo de material corresponde." };
  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(presentacionMp)
      .values({ nombre, kg: String(input.kg), materiaPrimaId: input.materiaPrimaId ?? null, tipoMp: input.materiaPrimaId ? null : input.tipoMp })
      .returning();
    await registrarCambios(tx, actor.id, [{ entidad: "presentacion_mp", entidadId: p.id, campo: "alta", anterior: null, nuevo: `${nombre} (${input.kg} kg)` }]);
    return { id: p.id };
  });
}

export type ItemReceta = {
  materiaPrimaId: number;
  materiaPrimaNombre: string;
  materiaPrimaCodigo: string;
  esMaster: boolean;
  presentacionId: number;
  presentacionNombre: string;
  kgPresentacion: number;
  cantidad: number;
  kg: number;
  /** "4 bolsas de 25 kg" */
  texto: string;
};

export type Receta = {
  id: number;
  productoId: number;
  tipo: TipoReceta;
  observaciones: string | null;
  items: ItemReceta[];
  kgVirgen: number;
  kgMaster: number;
  /** Gramos de master por kg de material base, sólo informativo. */
  gMasterPorKg: number | null;
};

function armar(r: typeof recetaCarga.$inferSelect, filas: Omit<ItemReceta, "kg" | "texto">[]): Receta {
  const items = filas.map((i) => ({ ...i, kg: kgDe(i.cantidad, i.kgPresentacion), texto: fmtPresentacion(i.cantidad, i.presentacionNombre) }));
  const gV = items.filter((i) => !i.esMaster).reduce((t, i) => t + aGramos(i.kg), 0);
  const gM = items.filter((i) => i.esMaster).reduce((t, i) => t + aGramos(i.kg), 0);
  return {
    id: r.id,
    productoId: r.productoId,
    tipo: r.tipo,
    observaciones: r.observaciones,
    items,
    kgVirgen: gV / 1000,
    kgMaster: gM / 1000,
    gMasterPorKg: gV > 0 ? Math.round((gM / (gV / 1000)) * 100) / 100 : null,
  };
}

/** Recetas de uno o varios productos, por tipo. */
export async function recetasDe(productoIds: number[]): Promise<Map<number, Partial<Record<TipoReceta, Receta>>>> {
  const res = new Map<number, Partial<Record<TipoReceta, Receta>>>();
  if (productoIds.length === 0) return res;
  const cabeceras = await db.select().from(recetaCarga).where(inArray(recetaCarga.productoId, productoIds));
  if (cabeceras.length === 0) return res;
  const items = await db
    .select({
      recetaId: recetaCargaItem.recetaId,
      materiaPrimaId: recetaCargaItem.materiaPrimaId,
      materiaPrimaNombre: materiaPrima.nombre,
      materiaPrimaCodigo: materiaPrima.codigoInterno,
      mpTipo: materiaPrima.tipo,
      presentacionId: recetaCargaItem.presentacionId,
      presentacionNombre: presentacionMp.nombre,
      kgPresentacion: presentacionMp.kg,
      cantidad: recetaCargaItem.cantidad,
    })
    .from(recetaCargaItem)
    .innerJoin(materiaPrima, eq(recetaCargaItem.materiaPrimaId, materiaPrima.id))
    .innerJoin(presentacionMp, eq(recetaCargaItem.presentacionId, presentacionMp.id))
    .where(inArray(recetaCargaItem.recetaId, cabeceras.map((c) => c.id)))
    .orderBy(asc(recetaCargaItem.id));
  for (const c of cabeceras) {
    const filas = items
      .filter((i) => i.recetaId === c.id)
      .map((i) => ({
        materiaPrimaId: i.materiaPrimaId,
        materiaPrimaNombre: i.materiaPrimaNombre,
        materiaPrimaCodigo: i.materiaPrimaCodigo,
        esMaster: i.mpTipo === "MASTER",
        presentacionId: i.presentacionId,
        presentacionNombre: i.presentacionNombre,
        kgPresentacion: Number(i.kgPresentacion),
        cantidad: Number(i.cantidad),
      }));
    const actual = res.get(c.productoId) ?? {};
    actual[c.tipo] = armar(c, filas);
    res.set(c.productoId, actual);
  }
  return res;
}

export type ItemRecetaInput = { materiaPrimaId: number; presentacionId: number; cantidad: number };

function describir(items: { nombre: string; texto: string }[]): string {
  return items.map((i) => `${i.texto} · ${i.nombre}`).join(" + ") || "(vacía)";
}

/**
 * Guarda (reemplaza) la receta de un producto. Valida que cada presentación
 * corresponda al material y que las cantidades sean enteras o medias. Queda en
 * el historial con la receta anterior y la nueva.
 */
export async function guardarReceta(
  actor: Actor,
  productoId: number,
  tipo: TipoReceta,
  input: { items: ItemRecetaInput[]; observaciones?: string | null; motivo?: string | null },
): Promise<Resultado> {
  if (!puedeEditarRecetas(actor.rol)) return { error: "No tenés permiso para configurar recetas de carga." };
  const items = input.items.filter((i) => i.materiaPrimaId && i.presentacionId);
  if (items.length === 0) return { error: "La receta necesita al menos un material." };
  for (const i of items) {
    if (!Number.isFinite(i.cantidad) || i.cantidad <= 0) return { error: "Cada material necesita una cantidad mayor que cero." };
    if (Math.abs(i.cantidad * 2 - Math.round(i.cantidad * 2)) > 1e-9) return { error: "Las cantidades van en bolsas enteras o medias (0,5)." };
    if (i.cantidad > 100) return { error: "La cantidad de bolsas por carga parece demasiado alta (más de 100)." };
  }
  if (new Set(items.map((i) => `${i.materiaPrimaId}-${i.presentacionId}`)).size !== items.length) {
    return { error: "Hay un material repetido con la misma presentación: sumá las cantidades en un solo renglón." };
  }
  const [prod] = await db
    .select({ id: producto.id, aceptaSobrante: producto.aceptaSobrante, aceptaMolienda: producto.aceptaMolienda, colorClave: color.clave, colorNombre: color.nombre })
    .from(producto)
    .leftJoin(color, eq(producto.colorId, color.id))
    .where(eq(producto.id, productoId));
  if (!prod) return { error: "Producto no encontrado." };
  const mps = await db.select().from(materiaPrima).where(inArray(materiaPrima.id, items.map((i) => i.materiaPrimaId)));
  // Sobrante (habilitado en todos los productos desde el 22/10) y molienda
  // (aparte, por producto) como materia prima, según el parámetro del producto.
  const sobrante = mps.find((m) => m.tipo === "SOBRANTE");
  if (sobrante && !prod.aceptaSobrante) {
    return { error: `${sobrante.nombre} es sobrante y este producto no admite sobrante como materia prima (Configuración → Productos).` };
  }
  const molienda = mps.find((m) => m.tipo === "MOLIENDA");
  if (molienda && !prod.aceptaMolienda) {
    return { error: `${molienda.nombre} es molienda (material reciclado) y este producto no admite molienda en su receta (Configuración → Productos).` };
  }
  // No mezclar un sobrante con master de otro color: si el nombre del sobrante
  // dice el color de su master y no es el del producto, se rechaza.
  if (sobrante || molienda) {
    const colores = await db.select({ clave: color.clave, nombre: color.nombre }).from(color);
    for (const m of mps.filter((x) => x.tipo === "SOBRANTE" || x.tipo === "MOLIENDA")) {
      const nombre = normalizarTexto(m.nombre);
      const mencionados = colores.flatMap((c) => (c.clave && new RegExp(`(^|[^a-z])${c.clave}([^a-z]|$)`).test(nombre) ? [{ clave: c.clave, nombre: c.nombre }] : []));
      const masLargos = mencionados.filter((c) => !mencionados.some((o) => o !== c && o.clave.includes(c.clave)));
      if (masLargos.length && prod.colorClave && !masLargos.some((c) => c.clave === prod.colorClave)) {
        return { error: `${m.nombre} lleva master ${masLargos.map((c) => c.nombre).join(" / ")}: no se mezcla en un producto ${prod.colorNombre}.` };
      }
    }
  }
  const pres = await db.select().from(presentacionMp).where(inArray(presentacionMp.id, items.map((i) => i.presentacionId)));
  for (const i of items) {
    const mp = mps.find((m) => m.id === i.materiaPrimaId);
    const p = pres.find((x) => x.id === i.presentacionId);
    if (!mp || !p) return { error: "Material o presentación inexistente." };
    if (!(p.materiaPrimaId === mp.id || (p.materiaPrimaId == null && p.tipoMp === mp.tipo))) {
      return { error: `La presentación «${p.nombre}» no corresponde a ${mp.nombre}.` };
    }
  }
  const anterior = (await recetasDe([productoId])).get(productoId)?.[tipo];
  const nuevoTexto = describir(
    items.map((i) => {
      const p = pres.find((x) => x.id === i.presentacionId)!;
      return { nombre: mps.find((m) => m.id === i.materiaPrimaId)!.nombre, texto: fmtPresentacion(i.cantidad, p.nombre) };
    }),
  );
  return db.transaction(async (tx) => {
    let recetaId = anterior?.id;
    if (recetaId) {
      await tx.delete(recetaCargaItem).where(eq(recetaCargaItem.recetaId, recetaId));
      await tx
        .update(recetaCarga)
        .set({ observaciones: input.observaciones?.trim() || null, actualizadoEn: new Date(), actualizadoPorId: actor.id })
        .where(eq(recetaCarga.id, recetaId));
    } else {
      const [r] = await tx
        .insert(recetaCarga)
        .values({ productoId, tipo, observaciones: input.observaciones?.trim() || null, actualizadoPorId: actor.id })
        .returning();
      recetaId = r.id;
    }
    await tx.insert(recetaCargaItem).values(
      items.map((i) => ({ recetaId: recetaId!, materiaPrimaId: i.materiaPrimaId, presentacionId: i.presentacionId, cantidad: String(i.cantidad) })),
    );
    await registrarCambios(tx, actor.id, [
      {
        entidad: "receta_carga",
        entidadId: productoId,
        campo: tipo === "REGIMEN" ? "receta de régimen" : "receta de arranque",
        anterior: anterior ? describir(anterior.items.map((i) => ({ nombre: i.materiaPrimaNombre, texto: i.texto }))) : null,
        nuevo: nuevoTexto,
        motivo: input.motivo,
      },
    ]);
    return {};
  });
}

/** Quita la receta de arranque (la de régimen no se borra: se reemplaza). */
export async function quitarRecetaArranque(actor: Actor, productoId: number, motivo?: string | null): Promise<Resultado> {
  if (!puedeEditarRecetas(actor.rol)) return { error: "No tenés permiso para configurar recetas de carga." };
  const anterior = (await recetasDe([productoId])).get(productoId)?.ARRANQUE;
  if (!anterior) return {};
  return db.transaction(async (tx) => {
    await tx.delete(recetaCarga).where(eq(recetaCarga.id, anterior.id));
    await registrarCambios(tx, actor.id, [
      {
        entidad: "receta_carga",
        entidadId: productoId,
        campo: "receta de arranque",
        anterior: describir(anterior.items.map((i) => ({ nombre: i.materiaPrimaNombre, texto: i.texto }))),
        nuevo: null,
        motivo,
      },
    ]);
    return {};
  });
}

/** Productos activos con su color y si tienen receta — para la pantalla de recetas. */
export async function productosConReceta() {
  const prods = await db
    .select({
      id: producto.id,
      codigo: producto.codigo,
      descripcion: producto.descripcion,
      familia: producto.familia,
      tipo: producto.tipo,
      esAccesorio: producto.esAccesorio,
      colorNombre: color.nombre,
    })
    .from(producto)
    .leftJoin(color, eq(producto.colorId, color.id))
    .where(eq(producto.activo, true))
    .orderBy(asc(producto.codigo));
  const recetas = await recetasDe(prods.map((p) => p.id));
  return prods.map((p) => ({ ...p, recetas: recetas.get(p.id) ?? {} }));
}

/** Materiales que pueden ir en una receta (vírgenes, master, molienda/sobrante). */
export async function materialesParaReceta() {
  return db
    .select({ id: materiaPrima.id, codigo: materiaPrima.codigoInterno, nombre: materiaPrima.nombre, tipo: materiaPrima.tipo })
    .from(materiaPrima)
    .where(eq(materiaPrima.activo, true))
    .orderBy(asc(materiaPrima.tipo), asc(materiaPrima.codigoInterno));
}

/** minúsculas, sin acentos, espacios simples (mismo criterio que color.clave). */
function normalizarTexto(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
