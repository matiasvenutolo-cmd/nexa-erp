import { asc, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { cliente } from "@/lib/db/schema";

export type Cliente = typeof cliente.$inferSelect;

export async function listarClientes(texto?: string): Promise<Cliente[]> {
  return db
    .select()
    .from(cliente)
    .where(texto ? ilike(cliente.nombre, `%${texto}%`) : undefined)
    .orderBy(asc(cliente.nombre));
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
