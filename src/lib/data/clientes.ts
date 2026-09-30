import { asc, eq, ilike } from "drizzle-orm";
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
