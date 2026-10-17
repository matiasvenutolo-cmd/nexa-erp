import { and, desc, eq, ilike, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cliente, despacho, pedido, pedidoLinea, producto } from "@/lib/db/schema";

export type Cliente = typeof cliente.$inferSelect;

export async function listarClientes(texto?: string, orden: "az" | "za" = "az"): Promise<Cliente[]> {
  // Orden alfabético sin distinguir mayúsculas ("carrefour" y "Carrefour" juntos).
  return db
    .select()
    .from(cliente)
    .where(texto ? ilike(cliente.nombre, `%${texto}%`) : undefined)
    .orderBy(orden === "za" ? sql`lower(${cliente.nombre}) desc` : sql`lower(${cliente.nombre}) asc`);
}

/**
 * Historial de pedidos de un cliente: estado, fechas, productos y despachos
 * (con su remito). Los precios se muestran sólo a quien los puede ver (lo
 * decide la página).
 */
export async function historialCliente(clienteId: number) {
  const pedidos = await db
    .select({ id: pedido.id, numeroOrden: pedido.numeroOrden, fechaPedido: pedido.fechaPedido, fechaEntrega: pedido.fechaEntregaPactada, estado: pedido.estado, total: pedido.total, archivado: pedido.archivado })
    .from(pedido)
    .where(eq(pedido.clienteId, clienteId))
    .orderBy(desc(pedido.fechaPedido), desc(pedido.id));
  if (pedidos.length === 0) return [];
  const ids = pedidos.map((p) => p.id);
  const lineas = await db
    .select({ pedidoId: pedidoLinea.pedidoId, unidades: pedidoLinea.unidadesPedidas, entregadas: pedidoLinea.unidadesDespachadas, codigo: producto.codigo, descripcion: producto.descripcion, colorTexto: pedidoLinea.colorTexto })
    .from(pedidoLinea)
    .leftJoin(producto, eq(pedidoLinea.productoId, producto.id))
    .where(inArray(pedidoLinea.pedidoId, ids));
  const despachos = await db
    .select({ id: despacho.id, pedidoId: despacho.pedidoId, estado: despacho.estado, numeroInterno: despacho.numeroInterno, numeroRemito: despacho.numeroRemito, entregadoEn: despacho.entregadoEn })
    .from(despacho)
    .where(and(inArray(despacho.pedidoId, ids), ne(despacho.estado, "ANULADO")));
  return pedidos.map((p) => ({ ...p, lineas: lineas.filter((l) => l.pedidoId === p.id), despachos: despachos.filter((d) => d.pedidoId === p.id) }));
}

export async function getCliente(id: number): Promise<Cliente | undefined> {
  const [row] = await db.select().from(cliente).where(eq(cliente.id, id));
  return row;
}

/** Misma normalización que el índice único `cliente_nombre_normalizado_uq`. */
export async function buscarClientePorNombre(nombre: string): Promise<Cliente | undefined> {
  const [row] = await db
    .select()
    .from(cliente)
    .where(sql`lower(btrim(${cliente.nombre})) = lower(btrim(${nombre}))`);
  return row;
}

/**
 * Cliente de un pedido. Definiciones pendientes, respuesta 7: la mayoría
 * compra una sola vez, así que el registro se genera con la carga de la
 * compra, para "levantar automáticamente los datos si vuelven a comprar".
 *
 * - Cliente nuevo cuyo nombre ya existe (con otras mayúsculas o espacios):
 *   se reutiliza el existente, no se duplica.
 * - Teléfono y domicilio del pedido completan los datos del cliente que
 *   estén vacíos. Nunca se pisan datos ya cargados.
 */
export async function resolverClienteDelPedido(input: {
  clienteId?: number | null;
  nombreNuevo?: string | null;
  telefono: string | null;
  domicilio: string | null;
}): Promise<{ id: number } | { error: string }> {
  let actual: Cliente | undefined;
  if (input.clienteId) {
    actual = await getCliente(input.clienteId);
    if (!actual) return { error: "El cliente elegido no existe." };
  } else {
    const nombre = input.nombreNuevo?.trim().replace(/\s+/g, " ");
    if (!nombre) return { error: "Elegí un cliente o cargá uno nuevo." };
    actual = await buscarClientePorNombre(nombre);
    if (!actual) {
      const [nuevo] = await db
        .insert(cliente)
        .values({ nombre, telefono: input.telefono, domicilio: input.domicilio })
        .returning();
      return { id: nuevo.id };
    }
  }

  const completar: Partial<Pick<Cliente, "telefono" | "domicilio">> = {};
  if (!actual.telefono && input.telefono) completar.telefono = input.telefono;
  if (!actual.domicilio && input.domicilio) completar.domicilio = input.domicilio;
  if (Object.keys(completar).length > 0) {
    await db.update(cliente).set(completar).where(eq(cliente.id, actual.id));
  }
  return { id: actual.id };
}
