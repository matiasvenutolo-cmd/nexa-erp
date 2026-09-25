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
import { producto, color, saldo, proveedorMaster } from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { semaforoStock, type EstadoSemaforo } from "@/lib/data/stock";
import { resolverColor, tipoCodigoDe, generarIniciales } from "@/lib/catalogo-normalizacion";
import type { FamiliaProducto, TipoProducto } from "@/lib/catalogo-normalizacion";

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

export type NuevoProductoInput = {
  familia: FamiliaProducto;
  tipo: TipoProducto;
  colorNombre: string;
  proveedorMasterId: number;
};

export type NuevoProductoResultado =
  | { ok: true; id: number; codigo: string; descripcion: string }
  | { ok: false; error: string };

/**
 * Alta de producto/color a medida desde el formulario de pedido — pedido del
 * cliente en docs/06-comentarios-produccion.md §5: "que en la sección
 * Pedidos se pueda crear un nuevo producto asignando código y un nuevo
 * color". El código se deriva con la misma regla que el importador (§3.1),
 * nunca se tipea: por eso pide familia+tipo+color+proveedor y no un código a
 * mano.
 */
export async function crearProductoNuevo(input: NuevoProductoInput): Promise<NuevoProductoResultado> {
  const tipoCodigo = tipoCodigoDe(input.familia, input.tipo);
  if (!tipoCodigo) return { ok: false, error: "Combinación de familia y tipo sin código asignado." };

  const [prov] = await db
    .select({ inicial: proveedorMaster.inicial, nombre: proveedorMaster.nombre })
    .from(proveedorMaster)
    .where(eq(proveedorMaster.id, input.proveedorMasterId));
  if (!prov) return { ok: false, error: "Proveedor de master inválido." };

  // Color: reusa uno existente (canónico o ya creado a medida) por nombre;
  // si es nuevo de verdad, le genera iniciales que no choquen con ninguna
  // de las ya usadas en la base — no sólo la lista canónica en memoria.
  let colorId: number;
  let colorNombreFinal: string;
  const existente = await db.query.color.findFirst({
    where: (c, { ilike }) => ilike(c.nombre, input.colorNombre.trim()),
  });
  if (existente) {
    colorId = existente.id;
    colorNombreFinal = existente.nombre;
  } else {
    const canonico = resolverColor(input.colorNombre);
    const todasLasIniciales = await db.select({ iniciales: color.iniciales }).from(color);
    const usadas = new Set(todasLasIniciales.map((c) => c.iniciales));
    const nombre = canonico?.nombre ?? input.colorNombre.trim();
    const iniciales = canonico && !usadas.has(canonico.iniciales) ? canonico.iniciales : generarIniciales(nombre, usadas);
    const [nuevo] = await db
      .insert(color)
      .values({ nombre, iniciales, oficial: false })
      .returning();
    colorId = nuevo.id;
    colorNombreFinal = nuevo.nombre;
  }

  // Próximo número correlativo del catálogo.
  const [{ maxNumero }] = await db
    .select({ maxNumero: sql<number>`coalesce(max(${producto.numero}::int), 0)`.mapWith(Number) })
    .from(producto);
  const numero = String(maxNumero + 1).padStart(3, "0");

  const [colorRow] = await db.select({ iniciales: color.iniciales }).from(color).where(eq(color.id, colorId));
  const codigo = `${numero}${prov.inicial}-${tipoCodigo}-${colorRow.iniciales}`;
  const esAccesorio = input.tipo === "BORDE" || input.tipo === "ESQUINERO" || input.tipo === "RAMPA";
  const esPiso = input.tipo === "UNICO" || input.tipo === "MONEDA" || input.tipo === "TRAMA";
  const descripcion = `${numero}${prov.inicial}-${input.familia === "REJILLA" ? "Rejilla" : "Ciego"} -${input.tipo} - ${colorNombreFinal}`;

  const [nuevo] = await db
    .insert(producto)
    .values({
      numero,
      codigo,
      descripcion,
      familia: input.familia,
      tipo: input.tipo,
      tipoCodigo,
      colorId,
      proveedorMasterId: input.proveedorMasterId,
      m2PorUnidad: esPiso ? "0.16" : null,
      kgPorUnidad: esPiso ? "0.610" : null,
      piezasPorGolpe: input.tipo === "RAMPA" ? 2 : input.tipo === "ESQUINERO" || input.tipo === "BORDE" ? 4 : 1,
      unidadesPorCaja: input.familia === "REJILLA" ? 8 : 25,
      esAccesorio,
      observaciones: "Color a medida — dado de alta desde la carga de un pedido.",
    })
    .returning();

  // Todo producto tiene su fila de saldo, en 0, desde que nace — si no, el
  // chequeo de disponible (src/lib/data/stock.ts) no encuentra nada para él
  // y lo muestra como "Sin stock" en vez de "Falta producir N", que es lo
  // que realmente significa un producto recién creado sin producción aún.
  const depositoId = await getDepositoNexaId();
  await db.insert(saldo).values({ depositoId, productoId: nuevo.id, cantidad: "0" });

  return { ok: true, id: nuevo.id, codigo: nuevo.codigo, descripcion: nuevo.descripcion };
}
