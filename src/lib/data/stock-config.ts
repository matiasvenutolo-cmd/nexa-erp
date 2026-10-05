/**
 * Mínimos y máximos de stock — configuración, no constantes. Definiciones
 * pendientes, respuesta 3: "estos pueden ir variando según ventas ...
 * supongamos que Carrefour normaliza nuestros pisos para toda la cadena, los
 * mínimos del color azul se dispararían". El semáforo (src/lib/data/stock.ts)
 * lee estos valores en cada consulta: cambiar uno acá lo cambia en todo el
 * sistema sin tocar código.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { color, materiaPrima, producto, saldo } from "@/lib/db/schema";
import { puedeEditarMinMax } from "@/lib/auth/permisos";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { obtenerParametros } from "@/lib/data/parametros";
import { semaforoStock, type EstadoSemaforo } from "@/lib/data/stock";
import { registrarCambios, ultimasModificaciones, type Actor, type Resultado } from "@/lib/data/auditoria";

export type MinMaxInput = { minimo: number | null; maximo: number | null; motivo?: string | null };

function validar(input: MinMaxInput, enteros: boolean): string | null {
  for (const [campo, v] of [["mínimo", input.minimo], ["máximo", input.maximo]] as const) {
    if (v == null) continue;
    if (!Number.isFinite(v) || v < 0) return `El ${campo} tiene que ser un número mayor o igual a cero.`;
    if (enteros && !Number.isInteger(v)) return `El ${campo} tiene que ser un número entero de unidades.`;
  }
  if (input.minimo != null && input.maximo != null && input.maximo > 0 && input.maximo < input.minimo) {
    return "El máximo no puede ser menor que el mínimo.";
  }
  return null;
}

export type FilaMinMax = {
  id: number;
  codigo: string;
  descripcion: string;
  grupo: string;
  stock: number;
  minimo: number | null;
  maximo: number | null;
  estado: EstadoSemaforo;
  ultimaModificacion: { fecha: Date; usuarioNombre: string } | null;
};

export async function listarMinMaxProductos(): Promise<FilaMinMax[]> {
  const depositoId = await getDepositoNexaId();
  const [filas, parametros] = await Promise.all([
    db
      .select({
        id: producto.id,
        codigo: producto.codigo,
        descripcion: producto.descripcion,
        familia: producto.familia,
        tipo: producto.tipo,
        colorNombre: color.nombre,
        minimo: producto.minimo,
        maximo: producto.maximo,
        stock: sql<string>`coalesce(${saldo.cantidad}, 0)`,
      })
      .from(producto)
      .innerJoin(color, eq(producto.colorId, color.id))
      .leftJoin(saldo, and(eq(saldo.productoId, producto.id), eq(saldo.depositoId, depositoId)))
      .where(eq(producto.activo, true))
      .orderBy(asc(producto.familia), asc(producto.tipo), asc(color.nombre)),
    obtenerParametros(),
  ]);
  const ultimas = await ultimasModificaciones("producto", filas.map((f) => f.id));
  return filas.map((f) => ({
    id: f.id,
    codigo: f.codigo,
    descripcion: f.descripcion,
    grupo: `${f.familia} ${f.tipo}`,
    stock: Number(f.stock),
    minimo: f.minimo,
    maximo: f.maximo,
    estado: semaforoStock(f.stock, f.minimo, f.maximo, parametros.semaforo_margen_bajo),
    ultimaModificacion: ultimas.get(String(f.id)) ?? null,
  }));
}

export async function listarMinMaxMateriaPrima(): Promise<FilaMinMax[]> {
  const depositoId = await getDepositoNexaId();
  const [filas, parametros] = await Promise.all([
    db
      .select({
        id: materiaPrima.id,
        codigo: materiaPrima.codigoInterno,
        descripcion: materiaPrima.nombre,
        tipo: materiaPrima.tipo,
        minimo: materiaPrima.minimo,
        maximo: materiaPrima.maximo,
        stock: sql<string>`coalesce(${saldo.cantidad}, 0)`,
      })
      .from(materiaPrima)
      .leftJoin(saldo, and(eq(saldo.materiaPrimaId, materiaPrima.id), eq(saldo.depositoId, depositoId)))
      .where(eq(materiaPrima.activo, true))
      .orderBy(asc(materiaPrima.tipo), asc(materiaPrima.id)),
    obtenerParametros(),
  ]);
  const ultimas = await ultimasModificaciones("materia_prima", filas.map((f) => f.id));
  return filas.map((f) => ({
    id: f.id,
    codigo: f.codigo,
    descripcion: f.descripcion,
    grupo: f.tipo,
    stock: Number(f.stock),
    minimo: f.minimo != null ? Number(f.minimo) : null,
    maximo: f.maximo != null ? Number(f.maximo) : null,
    estado: semaforoStock(f.stock, f.minimo, f.maximo, parametros.semaforo_margen_bajo),
    ultimaModificacion: ultimas.get(String(f.id)) ?? null,
  }));
}

export async function actualizarMinMaxProducto(actor: Actor, productoId: number, input: MinMaxInput): Promise<Resultado> {
  if (!puedeEditarMinMax(actor.rol)) return { error: "No tenés permiso para cambiar mínimos y máximos." };
  const error = validar(input, true);
  if (error) return { error };

  return db.transaction(async (tx) => {
    const [actual] = await tx
      .select({ minimo: producto.minimo, maximo: producto.maximo })
      .from(producto)
      .where(eq(producto.id, productoId));
    if (!actual) return { error: "Producto no encontrado." };
    await tx.update(producto).set({ minimo: input.minimo, maximo: input.maximo }).where(eq(producto.id, productoId));
    await registrarCambios(tx, actor.id, [
      { entidad: "producto", entidadId: productoId, campo: "minimo", anterior: actual.minimo, nuevo: input.minimo, motivo: input.motivo },
      { entidad: "producto", entidadId: productoId, campo: "maximo", anterior: actual.maximo, nuevo: input.maximo, motivo: input.motivo },
    ]);
    return {};
  });
}

export async function actualizarMinMaxMateriaPrima(actor: Actor, mpId: number, input: MinMaxInput): Promise<Resultado> {
  if (!puedeEditarMinMax(actor.rol)) return { error: "No tenés permiso para cambiar mínimos y máximos." };
  const error = validar(input, false);
  if (error) return { error };

  return db.transaction(async (tx) => {
    const [actual] = await tx
      .select({ minimo: materiaPrima.minimo, maximo: materiaPrima.maximo })
      .from(materiaPrima)
      .where(eq(materiaPrima.id, mpId));
    if (!actual) return { error: "Materia prima no encontrada." };
    await tx
      .update(materiaPrima)
      .set({
        minimo: input.minimo != null ? String(input.minimo) : null,
        maximo: input.maximo != null ? String(input.maximo) : null,
      })
      .where(eq(materiaPrima.id, mpId));
    await registrarCambios(tx, actor.id, [
      { entidad: "materia_prima", entidadId: mpId, campo: "minimo", anterior: actual.minimo, nuevo: input.minimo, motivo: input.motivo },
      { entidad: "materia_prima", entidadId: mpId, campo: "maximo", anterior: actual.maximo, nuevo: input.maximo, motivo: input.motivo },
    ]);
    return {};
  });
}
