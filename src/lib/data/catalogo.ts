/**
 * Catálogo de productos — paso 3 de docs/03-plan-release-1.md.
 *
 * El semáforo usa el STOCK ACTUAL (saldo), no el disponible neto de reservas:
 * esa distinción es para el chequeo puntual de un pedido (src/lib/data/stock.ts
 * `disponiblePorProducto`), acá se quiere ver de un vistazo la foto real del
 * depósito.
 */
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { producto, color, saldo } from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { semaforoStock, type EstadoSemaforo } from "@/lib/data/stock";

export type FilaProducto = {
  id: number;
  codigo: string;
  descripcion: string;
  familia: (typeof producto.$inferSelect)["familia"];
  tipo: (typeof producto.$inferSelect)["tipo"];
  colorNombre: string;
  minimo: number | null;
  maximo: number | null;
  stock: number;
  estado: EstadoSemaforo;
};

export async function listarProductos(filtro?: {
  familia?: (typeof producto.$inferSelect)["familia"];
  texto?: string;
}): Promise<FilaProducto[]> {
  const depositoId = await getDepositoNexaId();

  const condiciones = [eq(producto.activo, true)];
  if (filtro?.familia) condiciones.push(eq(producto.familia, filtro.familia));
  if (filtro?.texto) {
    const like = `%${filtro.texto}%`;
    condiciones.push(or(ilike(producto.descripcion, like), ilike(producto.codigo, like))!);
  }

  const filas = await db
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
    .where(and(...condiciones))
    .orderBy(asc(producto.familia), asc(producto.tipo), asc(color.nombre));

  return filas.map((f) => {
    const stock = Number(f.stock);
    return {
      ...f,
      stock,
      estado: semaforoStock(stock, f.minimo, f.maximo),
    };
  });
}
