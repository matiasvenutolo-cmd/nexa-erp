import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { usuario } from "@/lib/db/schema";
import { hashSecret } from "@/lib/auth/hash";

export type Usuario = typeof usuario.$inferSelect;

export async function getUsuario(id: number): Promise<Usuario | undefined> {
  const [row] = await db.select().from(usuario).where(eq(usuario.id, id));
  return row;
}

export async function getUsuarioPorEmail(email: string): Promise<Usuario | undefined> {
  const [row] = await db
    .select()
    .from(usuario)
    .where(eq(usuario.email, email.trim().toLowerCase()));
  return row;
}

export async function getUsuariosPorRol(rol: Usuario["rol"]): Promise<Usuario[]> {
  return db.select().from(usuario).where(eq(usuario.rol, rol));
}

export type NuevoUsuarioInput = {
  nombre: string;
  rol: Usuario["rol"];
  email?: string;
  secreto: string; // contraseña (staff) o PIN (operario), en texto plano — se hashea acá
};

export async function crearUsuario(input: NuevoUsuarioInput): Promise<Usuario> {
  const hash = await hashSecret(input.secreto);
  const [nuevo] = await db
    .insert(usuario)
    .values({
      nombre: input.nombre,
      email: input.email?.trim().toLowerCase() || null,
      rol: input.rol,
      passwordHash: input.rol === "OPERARIO" ? null : hash,
      pinHash: input.rol === "OPERARIO" ? hash : null,
    })
    .returning();
  return nuevo;
}
