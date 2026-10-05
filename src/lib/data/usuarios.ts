import { asc, desc, eq, isNotNull, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { rolEnum, usuario } from "@/lib/db/schema";
import { hashSecret } from "@/lib/auth/hash";
import { puedeAdministrarUsuarios } from "@/lib/auth/permisos";
import { registrarCambios, type Actor, type Resultado } from "@/lib/data/auditoria";

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

// ---------------------------------------------------------------------------
// Panel Admin — usuarios
// ---------------------------------------------------------------------------

export type FilaUsuarioAdmin = Pick<Usuario, "id" | "nombre" | "email" | "rol" | "activo" | "creadoEn"> & {
  accede: "contraseña" | "PIN";
};

/** Personas que pueden entrar al sistema. Los usuarios técnicos que creó el
 *  importador ("Importación (sistema)", sin email ni PIN) no se listan. */
export async function listarUsuariosAdmin(): Promise<FilaUsuarioAdmin[]> {
  const filas = await db
    .select()
    .from(usuario)
    .where(or(isNotNull(usuario.email), isNotNull(usuario.pinHash)))
    .orderBy(desc(usuario.activo), asc(usuario.nombre));
  return filas.map((u) => ({
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    activo: u.activo,
    creadoEn: u.creadoEn,
    accede: u.rol === "OPERARIO" ? "PIN" : "contraseña",
  }));
}

function validarSecreto(rol: Usuario["rol"], secreto: string): string | null {
  if (rol === "OPERARIO") return /^\d{4,8}$/.test(secreto) ? null : "El PIN tiene que tener entre 4 y 8 números.";
  return secreto.length >= 8 ? null : "La contraseña tiene que tener al menos 8 caracteres.";
}

export async function crearUsuarioAdmin(actor: Actor, input: NuevoUsuarioInput): Promise<Resultado> {
  if (!puedeAdministrarUsuarios(actor.rol)) return { error: "No tenés permiso para administrar usuarios." };
  const nombre = input.nombre.trim();
  if (!nombre) return { error: "Falta el nombre." };
  if (!(rolEnum.enumValues as string[]).includes(input.rol)) return { error: "Rol inválido." };
  const email = input.email?.trim().toLowerCase() || null;
  if (input.rol !== "OPERARIO" && !email) return { error: "El email es obligatorio para entrar con contraseña." };
  const errorSecreto = validarSecreto(input.rol, input.secreto);
  if (errorSecreto) return { error: errorSecreto };
  if (email && (await getUsuarioPorEmail(email))) return { error: "Ya existe un usuario con ese email." };

  const nuevo = await crearUsuario({ ...input, nombre, email: email ?? undefined });
  await registrarCambios(db, actor.id, [
    { entidad: "usuario", entidadId: nuevo.id, campo: "alta", anterior: null, nuevo: `${nuevo.nombre} (${nuevo.rol})` },
  ]);
  return {};
}

export async function actualizarUsuarioAdmin(
  actor: Actor,
  id: number,
  input: { nombre: string; email: string | null; rol: Usuario["rol"]; activo: boolean },
): Promise<Resultado> {
  if (!puedeAdministrarUsuarios(actor.rol)) return { error: "No tenés permiso para administrar usuarios." };
  if (!(rolEnum.enumValues as string[]).includes(input.rol)) return { error: "Rol inválido." };
  const actual = await getUsuario(id);
  if (!actual) return { error: "Usuario no encontrado." };
  if (id === actor.id && (!input.activo || input.rol !== actual.rol)) {
    return { error: "No podés desactivarte ni cambiarte el rol a vos mismo." };
  }
  const nombre = input.nombre.trim();
  if (!nombre) return { error: "Falta el nombre." };
  const email = input.email?.trim().toLowerCase() || null;
  if (input.rol !== "OPERARIO" && !email) return { error: "El email es obligatorio para entrar con contraseña." };
  if (input.rol !== "OPERARIO" && !actual.passwordHash) {
    return { error: "Este usuario entra con PIN: para pasarlo a un rol con contraseña, primero cargale una contraseña." };
  }
  if (input.rol === "OPERARIO" && !actual.pinHash) {
    return { error: "Para pasar a Operario, primero cargale un PIN." };
  }
  if (email && email !== actual.email) {
    const otro = await getUsuarioPorEmail(email);
    if (otro && otro.id !== id) return { error: "Ya existe un usuario con ese email." };
  }

  await db.transaction(async (tx) => {
    await tx.update(usuario).set({ nombre, email, rol: input.rol, activo: input.activo }).where(eq(usuario.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "usuario", entidadId: id, campo: "nombre", anterior: actual.nombre, nuevo: nombre },
      { entidad: "usuario", entidadId: id, campo: "email", anterior: actual.email, nuevo: email },
      { entidad: "usuario", entidadId: id, campo: "rol", anterior: actual.rol, nuevo: input.rol },
      { entidad: "usuario", entidadId: id, campo: "activo", anterior: actual.activo, nuevo: input.activo },
    ]);
  });
  return {};
}

/** Nueva contraseña (o PIN, para operarios). Nunca se guarda el valor en la auditoría. */
export async function cambiarSecretoAdmin(actor: Actor, id: number, secreto: string, tipo: "contraseña" | "PIN"): Promise<Resultado> {
  if (!puedeAdministrarUsuarios(actor.rol)) return { error: "No tenés permiso para administrar usuarios." };
  const actual = await getUsuario(id);
  if (!actual) return { error: "Usuario no encontrado." };
  const errorSecreto = validarSecreto(tipo === "PIN" ? "OPERARIO" : "ADMINISTRACION", secreto);
  if (errorSecreto) return { error: errorSecreto };
  const hash = await hashSecret(secreto);
  await db.transaction(async (tx) => {
    await tx
      .update(usuario)
      .set(tipo === "PIN" ? { pinHash: hash } : { passwordHash: hash })
      .where(eq(usuario.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "usuario", entidadId: id, campo: tipo, anterior: "(anterior)", nuevo: "(cambiada)" },
    ]);
  });
  return {};
}
