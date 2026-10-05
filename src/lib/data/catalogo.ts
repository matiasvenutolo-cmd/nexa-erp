/**
 * Catálogo de productos — paso 3 de docs/03-plan-release-1.md.
 *
 * El semáforo usa el STOCK ACTUAL (saldo), no el disponible neto de reservas:
 * esa distinción es para el chequeo puntual de un pedido (src/lib/data/stock.ts
 * `disponiblePorProducto`), acá se quiere ver de un vistazo la foto real del
 * depósito.
 */
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { producto, color, saldo, proveedorMaster } from "@/lib/db/schema";
import { getDepositoNexaId } from "@/lib/data/depositos";
import { semaforoStock, type EstadoSemaforo } from "@/lib/data/stock";
import { obtenerParametros, type Parametros } from "@/lib/data/parametros";
import { registrarCambios, type Actor } from "@/lib/data/auditoria";
import { puedeCrearProducto } from "@/lib/auth/permisos";
import { claveColor, generarIniciales, pareceMulticolor, resolverColor, tipoCodigoDe } from "@/lib/catalogo-normalizacion";
import type { FamiliaProducto, TipoProducto } from "@/lib/catalogo-normalizacion";

export type FilaProducto = {
  id: number;
  codigo: string;
  codigoBarras: string | null;
  descripcion: string;
  familia: (typeof producto.$inferSelect)["familia"];
  tipo: (typeof producto.$inferSelect)["tipo"];
  colorId: number;
  colorNombre: string;
  colorEspecial: boolean;
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

  const [filas, parametros] = await Promise.all([
    db
      .select({
        id: producto.id,
        codigo: producto.codigo,
        codigoBarras: producto.codigoBarras,
        descripcion: producto.descripcion,
        familia: producto.familia,
        tipo: producto.tipo,
        colorId: producto.colorId,
        colorNombre: color.nombre,
        colorEspecial: color.especial,
        minimo: producto.minimo,
        maximo: producto.maximo,
        stock: sql<string>`coalesce(${saldo.cantidad}, 0)`,
      })
      .from(producto)
      .innerJoin(color, eq(producto.colorId, color.id))
      .leftJoin(saldo, and(eq(saldo.productoId, producto.id), eq(saldo.depositoId, depositoId)))
      .where(and(...condiciones))
      .orderBy(asc(producto.familia), asc(producto.tipo), asc(color.nombre)),
    obtenerParametros(),
  ]);

  return filas.map((f) => {
    const stock = Number(f.stock);
    return {
      ...f,
      stock,
      estado: semaforoStock(stock, f.minimo, f.maximo, parametros.semaforo_margen_bajo),
    };
  });
}

/**
 * Unidades por caja cerrada. Definiciones pendientes, respuesta 4: todos los
 * pisos llevan las mismas (parámetro `unidades_por_caja_pisos`), los
 * accesorios no se embalan hasta la venta. `producto.unidadesPorCaja` queda
 * como excepción puntual por producto.
 */
export function unidadesPorCaja(
  p: { esAccesorio: boolean; unidadesPorCaja: number | null },
  parametros: Pick<Parametros, "unidades_por_caja_pisos">,
): number | null {
  if (p.esAccesorio) return null;
  return p.unidadesPorCaja ?? parametros.unidades_por_caja_pisos;
}

/** 60 baldosas con cajas de 25 → 2 cajas cerradas + 10 sueltas (caja abierta). */
export function desglosarCajas(unidades: number, porCaja: number | null): { cajas: number; sueltas: number } | null {
  if (!porCaja || porCaja <= 0 || unidades <= 0) return null;
  return { cajas: Math.floor(unidades / porCaja), sueltas: unidades % porCaja };
}

export type NuevoProductoInput = {
  familia: FamiliaProducto;
  tipo: TipoProducto;
  colorNombre: string;
  proveedorMasterId: number;
  /** Solicitante del color especial (el cliente del pedido). */
  clienteId?: number | null;
  masterNombre?: string | null;
  masterCodigo?: string | null;
};

export type NuevoProductoResultado =
  | { ok: true; id: number; codigo: string; descripcion: string; colorId: number; colorNuevo: boolean }
  | { ok: false; error: string };

const TIPO_LABEL: Record<TipoProducto, string> = {
  UNICO: "Unico",
  TRAMA: "Trama",
  MONEDA: "Moneda",
  BORDE: "Borde",
  ESQUINERO: "Esquinero",
  RAMPA: "Rampa",
};

const TIPOS_ACCESORIO: TipoProducto[] = ["BORDE", "ESQUINERO", "RAMPA"];

/**
 * Producto de un color especial (o de un color que todavía no tiene SKU en
 * ese tipo) desde la carga del pedido — docs/06-comentarios-produccion.md §5
 * y Definiciones pendientes, respuesta 1.
 *
 * - El color se busca por su clave normalizada: "Azul Carrefour" y "azul
 *   carrefour" son el mismo y se reutiliza, con su proveedor y su master.
 * - Si es nuevo, queda registrado como color ESPECIAL con su solicitante,
 *   proveedor y master — nunca como texto libre dentro del pedido.
 * - Un nombre que describe varios colores ("negro y blanco") se rechaza:
 *   cada color va en su propio renglón (respuesta 6).
 * - Los datos físicos del producto (m², kg, piezas por golpe) se copian de
 *   un producto existente de la misma familia y tipo — no hay valores fijos.
 * - Si el producto ya existe (mismo tipo, color y proveedor), se reutiliza.
 */
export async function crearProductoNuevo(actor: Actor, input: NuevoProductoInput): Promise<NuevoProductoResultado> {
  if (!puedeCrearProducto(actor.rol)) return { ok: false, error: "No tenés permiso para dar de alta productos." };

  const tipoCodigo = tipoCodigoDe(input.familia, input.tipo);
  if (!tipoCodigo) return { ok: false, error: "Combinación de familia y tipo sin código asignado." };

  const nombreIngresado = input.colorNombre.trim().replace(/\s+/g, " ");
  if (!nombreIngresado) return { ok: false, error: "Falta el nombre del color." };

  const [prov] = await db
    .select({ inicial: proveedorMaster.inicial, nombre: proveedorMaster.nombre })
    .from(proveedorMaster)
    .where(eq(proveedorMaster.id, input.proveedorMasterId));
  if (!prov) return { ok: false, error: "Proveedor de master inválido." };

  const todosLosColores = await db.select().from(color);
  const clave = claveColor(nombreIngresado);
  const existente = todosLosColores.find((c) => c.clave === clave) ?? null;

  if (!existente && pareceMulticolor(nombreIngresado, todosLosColores.map((c) => c.nombre))) {
    return {
      ok: false,
      error: `"${nombreIngresado}" parece describir varios colores. Cargá cada color en su propio renglón, con su cantidad.`,
    };
  }

  if (existente) {
    const [productoExistente] = await db
      .select({ id: producto.id, codigo: producto.codigo, descripcion: producto.descripcion })
      .from(producto)
      .where(
        and(
          eq(producto.familia, input.familia),
          eq(producto.tipo, input.tipo),
          eq(producto.colorId, existente.id),
          eq(producto.proveedorMasterId, input.proveedorMasterId),
        ),
      );
    if (productoExistente) return { ok: true, ...productoExistente, colorId: existente.id, colorNuevo: false };

    if (existente.oficial && !existente.especial) {
      const [enLista] = await db
        .select({ id: producto.id })
        .from(producto)
        .where(and(eq(producto.familia, input.familia), eq(producto.tipo, input.tipo), eq(producto.colorId, existente.id)));
      if (enLista) {
        return { ok: false, error: `"${existente.nombre}" es un color de la lista oficial: elegilo en la lista de colores del ítem.` };
      }
    }
  }

  // Producto modelo de la misma familia y tipo, para copiar sus datos físicos.
  const [modelo] = await db
    .select({
      m2PorUnidad: producto.m2PorUnidad,
      kgPorUnidad: producto.kgPorUnidad,
      piezasPorGolpe: producto.piezasPorGolpe,
      pesoCajaKg: producto.pesoCajaKg,
      esAccesorio: producto.esAccesorio,
    })
    .from(producto)
    .innerJoin(color, eq(producto.colorId, color.id))
    .where(and(eq(producto.familia, input.familia), eq(producto.tipo, input.tipo)))
    .orderBy(desc(color.oficial), asc(producto.id))
    .limit(1);

  const depositoId = await getDepositoNexaId();

  return db.transaction(async (tx) => {
    let colorId: number;
    let colorNombre: string;
    let colorIniciales: string;
    let colorNuevo = false;

    if (existente) {
      colorId = existente.id;
      colorNombre = existente.nombre;
      colorIniciales = existente.iniciales;
    } else {
      const canonico = resolverColor(nombreIngresado);
      const usadas = new Set(todosLosColores.map((c) => c.iniciales));
      const nombre = canonico?.nombre ?? nombreIngresado;
      const iniciales =
        canonico && !usadas.has(canonico.iniciales) ? canonico.iniciales : generarIniciales(nombre, usadas);
      const [nuevo] = await tx
        .insert(color)
        .values({
          nombre,
          iniciales,
          oficial: false,
          especial: true,
          clienteId: input.clienteId ?? null,
          proveedorMasterId: input.proveedorMasterId,
          masterNombre: input.masterNombre?.trim() || null,
          masterCodigo: input.masterCodigo?.trim() || null,
          creadoPorId: actor.id,
        })
        .returning();
      await registrarCambios(tx, actor.id, [
        { entidad: "color", entidadId: nuevo.id, campo: "alta (color especial)", anterior: null, nuevo: nuevo.nombre },
      ]);
      colorId = nuevo.id;
      colorNombre = nuevo.nombre;
      colorIniciales = nuevo.iniciales;
      colorNuevo = true;
    }

    const [{ maxNumero }] = await tx
      .select({ maxNumero: sql<number>`coalesce(max(${producto.numero}::int), 0)`.mapWith(Number) })
      .from(producto)
      .where(sql`${producto.numero} ~ '^[0-9]+$'`);
    const numero = String(maxNumero + 1).padStart(3, "0");
    const codigo = `${numero}${prov.inicial}-${tipoCodigo}-${colorIniciales}`;
    const familiaLabel = input.familia === "REJILLA" ? "Rejilla" : "Ciego";
    const descripcion = `${numero}${prov.inicial}-${familiaLabel} -${TIPO_LABEL[input.tipo]} - ${colorNombre}`;

    const [nuevo] = await tx
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
        m2PorUnidad: modelo?.m2PorUnidad ?? null,
        kgPorUnidad: modelo?.kgPorUnidad ?? null,
        piezasPorGolpe: modelo?.piezasPorGolpe ?? null,
        pesoCajaKg: modelo?.pesoCajaKg ?? null,
        esAccesorio: modelo?.esAccesorio ?? TIPOS_ACCESORIO.includes(input.tipo),
        observaciones: "Dado de alta desde la carga de un pedido.",
      })
      .returning();

    // Todo producto nace con su fila de saldo en 0: si no, el chequeo de
    // disponible lo muestra "Sin stock" en vez de "Falta producir N".
    await tx.insert(saldo).values({ depositoId, productoId: nuevo.id, cantidad: "0" });
    await registrarCambios(tx, actor.id, [
      { entidad: "producto", entidadId: nuevo.id, campo: "alta", anterior: null, nuevo: nuevo.codigo },
    ]);

    return { ok: true as const, id: nuevo.id, codigo: nuevo.codigo, descripcion: nuevo.descripcion, colorId, colorNuevo };
  });
}
