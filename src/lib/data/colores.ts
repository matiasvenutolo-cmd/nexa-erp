/**
 * Colores — lista oficial y colores especiales registrados para poder
 * repetirlos (Definiciones pendientes, respuesta 1: "que estos colores queden
 * registrados en la lista como colores especiales con los solicitantes,
 * proveedor y número de catálogo para poder replicarlos a futuro").
 *
 * El nombre de un color no se edita desde acá: está dentro de la descripción
 * y el código de sus productos y de los pedidos históricos. Lo que se edita
 * es su ficha (solicitante, proveedor, master, observaciones).
 */
import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cliente, color, materiaPrima, producto, proveedorMaster } from "@/lib/db/schema";
import { puedeGestionarColores } from "@/lib/auth/permisos";
import { registrarCambios, ultimasModificaciones, type Actor, type Resultado } from "@/lib/data/auditoria";
import { claveColor, generarIniciales, pareceMulticolor } from "@/lib/catalogo-normalizacion";

export type FilaColor = {
  id: number;
  nombre: string;
  clave: string | null;
  iniciales: string;
  oficial: boolean;
  especial: boolean;
  clienteId: number | null;
  clienteNombre: string | null;
  proveedorMasterId: number | null;
  proveedorNombre: string | null;
  masterNombre: string | null;
  masterCodigo: string | null;
  masterMateriaPrimaId: number | null;
  masterMateriaPrimaNombre: string | null;
  observaciones: string | null;
  creadoEn: Date;
  productos: number;
  ultimaModificacion: { fecha: Date; usuarioNombre: string } | null;
};

export async function listarColores(filtro?: { texto?: string; soloEspeciales?: boolean }): Promise<FilaColor[]> {
  const filas = await db
    .select({
      id: color.id,
      nombre: color.nombre,
      clave: color.clave,
      iniciales: color.iniciales,
      oficial: color.oficial,
      especial: color.especial,
      clienteId: color.clienteId,
      clienteNombre: cliente.nombre,
      proveedorMasterId: color.proveedorMasterId,
      proveedorNombre: proveedorMaster.nombre,
      masterNombre: color.masterNombre,
      masterCodigo: color.masterCodigo,
      masterMateriaPrimaId: color.masterMateriaPrimaId,
      masterMateriaPrimaNombre: materiaPrima.nombre,
      observaciones: color.observaciones,
      creadoEn: color.creadoEn,
      productos: sql<number>`(select count(*) from ${producto} where ${producto.colorId} = ${color.id})`.mapWith(Number),
    })
    .from(color)
    .leftJoin(cliente, eq(color.clienteId, cliente.id))
    .leftJoin(proveedorMaster, eq(color.proveedorMasterId, proveedorMaster.id))
    .leftJoin(materiaPrima, eq(color.masterMateriaPrimaId, materiaPrima.id))
    .orderBy(desc(color.oficial), asc(color.especial), asc(color.nombre));

  const texto = filtro?.texto ? claveColor(filtro.texto) : null;
  const visibles = filas.filter(
    (f) =>
      (!filtro?.soloEspeciales || f.especial) &&
      (!texto ||
        (f.clave ?? "").includes(texto) ||
        claveColor(f.clienteNombre ?? "").includes(texto) ||
        claveColor(f.masterNombre ?? "").includes(texto) ||
        claveColor(f.masterCodigo ?? "").includes(texto)),
  );
  const ultimas = await ultimasModificaciones("color", visibles.map((f) => f.id));
  return visibles.map((f) => ({ ...f, ultimaModificacion: ultimas.get(String(f.id)) ?? null }));
}

export type ColorEspecialInput = {
  nombre: string;
  clienteId: number | null;
  proveedorMasterId: number | null;
  masterNombre?: string | null;
  masterCodigo?: string | null;
  masterMateriaPrimaId?: number | null;
  observaciones?: string | null;
};

/**
 * Registra un color especial sin necesidad de un pedido (p. ej. una prueba de
 * color de un cliente). Si el nombre ya existe —con cualquier combinación de
 * mayúsculas o acentos— no se duplica: devuelve el existente para reutilizarlo.
 */
export async function crearColorEspecial(
  actor: Actor,
  input: ColorEspecialInput,
): Promise<Resultado & { id?: number; existente?: boolean }> {
  if (!puedeGestionarColores(actor.rol)) return { error: "No tenés permiso para registrar colores." };
  const nombre = input.nombre.trim().replace(/\s+/g, " ");
  if (!nombre) return { error: "Falta el nombre del color." };

  const todos = await db.select({ id: color.id, nombre: color.nombre, clave: color.clave, iniciales: color.iniciales }).from(color);
  const ya = todos.find((c) => c.clave === claveColor(nombre));
  if (ya) return { error: `Ya existe el color "${ya.nombre}": usá ese registro.`, id: ya.id, existente: true };
  if (pareceMulticolor(nombre, todos.map((c) => c.nombre))) {
    return { error: `"${nombre}" parece describir varios colores. Cada color se registra por separado.` };
  }

  return db.transaction(async (tx) => {
    const [nuevo] = await tx
      .insert(color)
      .values({
        nombre,
        iniciales: generarIniciales(nombre, new Set(todos.map((c) => c.iniciales))),
        oficial: false,
        especial: true,
        clienteId: input.clienteId,
        proveedorMasterId: input.proveedorMasterId,
        masterNombre: input.masterNombre?.trim() || null,
        masterCodigo: input.masterCodigo?.trim() || null,
        masterMateriaPrimaId: input.masterMateriaPrimaId ?? null,
        observaciones: input.observaciones?.trim() || null,
        creadoPorId: actor.id,
      })
      .returning();
    await registrarCambios(tx, actor.id, [
      { entidad: "color", entidadId: nuevo.id, campo: "alta (color especial)", anterior: null, nuevo: nuevo.nombre },
    ]);
    return { id: nuevo.id };
  });
}

export type FichaColorInput = {
  especial: boolean;
  clienteId: number | null;
  proveedorMasterId: number | null;
  masterNombre: string | null;
  masterCodigo: string | null;
  masterMateriaPrimaId: number | null;
  observaciones: string | null;
  motivo?: string | null;
};

export async function actualizarFichaColor(actor: Actor, id: number, input: FichaColorInput): Promise<Resultado> {
  if (!puedeGestionarColores(actor.rol)) return { error: "No tenés permiso para editar colores." };

  return db.transaction(async (tx) => {
    const [actual] = await tx.select().from(color).where(eq(color.id, id));
    if (!actual) return { error: "Color no encontrado." };
    if (actual.oficial && input.especial) return { error: "Un color de la lista oficial no puede marcarse como especial." };

    const nuevo = {
      especial: input.especial,
      clienteId: input.clienteId,
      proveedorMasterId: input.proveedorMasterId,
      masterNombre: input.masterNombre?.trim() || null,
      masterCodigo: input.masterCodigo?.trim() || null,
      masterMateriaPrimaId: input.masterMateriaPrimaId,
      observaciones: input.observaciones?.trim() || null,
    };
    await tx.update(color).set(nuevo).where(eq(color.id, id));
    await registrarCambios(
      tx,
      actor.id,
      (Object.keys(nuevo) as (keyof typeof nuevo)[]).map((campo) => ({
        entidad: "color",
        entidadId: id,
        campo,
        anterior: actual[campo],
        nuevo: nuevo[campo],
        motivo: input.motivo,
      })),
    );
    return {};
  });
}

/** Colores especiales para el buscador del formulario de pedido. */
export async function coloresParaPedido() {
  return db
    .select({
      id: color.id,
      nombre: color.nombre,
      especial: color.especial,
      oficial: color.oficial,
      proveedorMasterId: color.proveedorMasterId,
      clienteNombre: cliente.nombre,
      masterNombre: color.masterNombre,
      masterCodigo: color.masterCodigo,
    })
    .from(color)
    .leftJoin(cliente, eq(color.clienteId, cliente.id))
    .orderBy(asc(color.nombre));
}

/** Masters cargados como materia prima, para vincular un color a su master. */
export async function mastersDisponibles() {
  return db
    .select({ id: materiaPrima.id, nombre: materiaPrima.nombre })
    .from(materiaPrima)
    .where(eq(materiaPrima.tipo, "MASTER"))
    .orderBy(asc(materiaPrima.nombre));
}
