import { and, arrayContains, asc, desc, eq, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { rolEnum, usuario } from "@/lib/db/schema";
import { hashSecret } from "@/lib/auth/hash";
import { ROLES_CON_PIN, puedeAdministrarOperarios, puedeAdministrarUsuarios, puedeOtorgarRol } from "@/lib/auth/permisos";
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

/**
 * Perfiles que la persona puede usar en esta sesión: el principal y los
 * adicionales, sin repetir. Con PIN, sólo los de planta (ROLES_CON_PIN); el
 * principal va primero salvo que no sea de planta.
 */
export function perfilesDe(u: Pick<Usuario, "rol" | "rolesAdicionales"> & { rolPrincipal?: Usuario["rol"] }, via: "clave" | "pin"): Usuario["rol"][] {
  // Con la sesión, `rol` es el perfil activo: el principal viene aparte.
  const principal = u.rolPrincipal ?? u.rol;
  const todos = [principal, ...(u.rolesAdicionales ?? [])].filter((r, i, a) => a.indexOf(r) === i);
  if (via === "clave") return todos;
  const planta = todos.filter((r) => ROLES_CON_PIN.includes(r));
  // Quien opera la máquina entra por PIN para eso: Operario primero.
  return planta.includes("OPERARIO") ? ["OPERARIO", ...planta.filter((r) => r !== "OPERARIO")] : planta;
}

/** Quienes tienen ese perfil, como principal o adicional (Dylan figura entre
 *  los operarios y entre quienes retiran MP). */
export async function getUsuariosPorRol(rol: Usuario["rol"]): Promise<Usuario[]> {
  return db
    .select()
    .from(usuario)
    .where(or(eq(usuario.rol, rol), arrayContains(usuario.rolesAdicionales, [rol])))
    .orderBy(asc(usuario.nombre));
}

/** Personas activas que pueden entrar con nombre + PIN (lista del login). */
export async function usuariosConPin(): Promise<Pick<Usuario, "id" | "nombre">[]> {
  const filas = await db
    .select()
    .from(usuario)
    .where(and(eq(usuario.activo, true), isNotNull(usuario.pinHash)))
    .orderBy(asc(usuario.nombre));
  return filas.filter((u) => perfilesDe(u, "pin").length > 0).map((u) => ({ id: u.id, nombre: u.nombre }));
}

export type NuevoUsuarioInput = {
  nombre: string;
  rol: Usuario["rol"];
  rolesAdicionales?: Usuario["rol"][];
  email?: string;
  /** Contraseña (entra con email) y/o PIN (entra con nombre, perfiles de
   *  planta). Sin ninguna, la cuenta queda pendiente de activación. */
  password?: string;
  pin?: string;
  /** Compatibilidad: secreto único según el rol (PIN para Operario). */
  secreto?: string;
};

export async function crearUsuario(input: NuevoUsuarioInput): Promise<Usuario> {
  const { password, pin } = credenciales(input);
  const [nuevo] = await db
    .insert(usuario)
    .values({
      nombre: input.nombre,
      email: input.email?.trim().toLowerCase() || null,
      rol: input.rol,
      rolesAdicionales: limpiarAdicionales(input.rol, input.rolesAdicionales),
      passwordHash: password ? await hashSecret(password) : null,
      pinHash: pin ? await hashSecret(pin) : null,
    })
    .returning();
  return nuevo;
}

function credenciales(input: Pick<NuevoUsuarioInput, "rol" | "password" | "pin" | "secreto">): { password: string | null; pin: string | null } {
  const password = input.password?.trim() ? input.password : null;
  const pin = input.pin?.trim() ? input.pin.trim() : null;
  if (password || pin || !input.secreto) return { password, pin };
  return input.rol === "OPERARIO" ? { password: null, pin: input.secreto } : { password: input.secreto, pin: null };
}

function limpiarAdicionales(rol: Usuario["rol"], adicionales?: Usuario["rol"][]): Usuario["rol"][] {
  const validos = rolEnum.enumValues as string[];
  return [...new Set((adicionales ?? []).filter((r) => r !== rol && validos.includes(r)))];
}

/** Email sin espacios y con forma de email (no se verifica que exista). */
export function normalizarEmail(email: string | null | undefined): { email: string | null } | { error: string } {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return { email: null };
  if (/\s/.test(e) || !/^[^@]+@[^@]+\.[^@]+$/.test(e)) return { error: `El email «${e}» no es válido (sin espacios, con @ y dominio).` };
  return { email: e };
}

// ---------------------------------------------------------------------------
// Panel Admin — usuarios
// ---------------------------------------------------------------------------

export type Acceso = "contraseña" | "PIN" | "contraseña y PIN" | "pendiente";

export type FilaUsuarioAdmin = Pick<Usuario, "id" | "nombre" | "email" | "rol" | "rolesAdicionales" | "activo" | "creadoEn"> & {
  accede: Acceso;
  tienePin: boolean;
  tieneClave: boolean;
};

function accesoDe(u: Pick<Usuario, "passwordHash" | "pinHash">): Acceso {
  if (u.passwordHash && u.pinHash) return "contraseña y PIN";
  if (u.passwordHash) return "contraseña";
  if (u.pinHash) return "PIN";
  return "pendiente";
}

/** Usuario técnico del importador de planillas: no es una persona. */
const USUARIO_TECNICO = "Importación (sistema)";

/** Personas del sistema (incluidas las pendientes de activación). Quien sólo
 *  administra operarios ve sólo operarios. */
export async function listarUsuariosAdmin(soloOperarios = false): Promise<FilaUsuarioAdmin[]> {
  const filas = await db
    .select()
    .from(usuario)
    .where(soloOperarios ? eq(usuario.rol, "OPERARIO") : sql`${usuario.nombre} <> ${USUARIO_TECNICO}`)
    .orderBy(desc(usuario.activo), asc(usuario.nombre));
  return filas.map((u) => ({
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    rol: u.rol,
    rolesAdicionales: u.rolesAdicionales,
    activo: u.activo,
    creadoEn: u.creadoEn,
    accede: accesoDe(u),
    tienePin: Boolean(u.pinHash),
    tieneClave: Boolean(u.passwordHash),
  }));
}

/** Supervisión y Gerencia administran a todos (los perfiles de gerencia, sólo
 *  Gerencia); Administración, sólo operarios. */
function permisoSobre(actor: Actor, ...roles: Usuario["rol"][]): string | null {
  if (puedeAdministrarUsuarios(actor.rol)) {
    const prohibido = roles.find((r) => !puedeOtorgarRol(actor.rol, r));
    return prohibido ? "Los perfiles de Gerencia sólo los asigna o modifica Gerencia." : null;
  }
  if (puedeAdministrarOperarios(actor.rol) && roles.every((r) => r === "OPERARIO")) return null;
  return puedeAdministrarOperarios(actor.rol) ? "Sólo Supervisión o Gerencia administran usuarios que no son Operario." : "No tenés permiso para administrar usuarios.";
}

function validarPassword(p: string): string | null {
  return p.length >= 8 ? null : "La contraseña tiene que tener al menos 8 caracteres.";
}

function validarPin(p: string): string | null {
  return /^\d{4,8}$/.test(p) ? null : "El PIN tiene que tener entre 4 y 8 números.";
}

function aceptaPin(roles: Usuario["rol"][]): boolean {
  return roles.some((r) => ROLES_CON_PIN.includes(r));
}

export async function crearUsuarioAdmin(actor: Actor, input: NuevoUsuarioInput): Promise<Resultado & { id?: number }> {
  const validos = rolEnum.enumValues as string[];
  if (!validos.includes(input.rol)) return { error: "Rol inválido." };
  const adicionales = limpiarAdicionales(input.rol, input.rolesAdicionales);
  const sinPermiso = permisoSobre(actor, input.rol, ...adicionales);
  if (sinPermiso) return { error: sinPermiso };
  const nombre = input.nombre.trim();
  if (!nombre) return { error: "Falta el nombre." };
  const em = normalizarEmail(input.email);
  if ("error" in em) return { error: em.error };
  const { password, pin } = credenciales(input);
  if (password) {
    const e = validarPassword(password);
    if (e) return { error: e };
    if (!em.email) return { error: "Para entrar con contraseña hace falta un email." };
  }
  if (pin) {
    const e = validarPin(pin);
    if (e) return { error: e };
    if (!aceptaPin([input.rol, ...adicionales])) return { error: "El PIN es sólo para perfiles de planta (Operario, Retiros de MP, Despacho, Molino, Matrices)." };
  }
  if (em.email && (await getUsuarioPorEmail(em.email))) return { error: "Ya existe un usuario con ese email." };

  const nuevo = await crearUsuario({ ...input, nombre, email: em.email ?? undefined, rolesAdicionales: adicionales, password: password ?? undefined, pin: pin ?? undefined, secreto: undefined });
  await registrarCambios(db, actor.id, [
    {
      entidad: "usuario",
      entidadId: nuevo.id,
      campo: "alta",
      anterior: null,
      nuevo: `${nuevo.nombre} (${[nuevo.rol, ...nuevo.rolesAdicionales].join(" + ")})${!password && !pin ? " · pendiente de activación" : ""}`,
    },
  ]);
  return { id: nuevo.id };
}

export async function actualizarUsuarioAdmin(
  actor: Actor,
  id: number,
  input: { nombre: string; email: string | null; rol: Usuario["rol"]; rolesAdicionales?: Usuario["rol"][]; activo: boolean },
): Promise<Resultado> {
  if (!(rolEnum.enumValues as string[]).includes(input.rol)) return { error: "Rol inválido." };
  const actual = await getUsuario(id);
  if (!actual) return { error: "Usuario no encontrado." };
  const adicionales = input.rolesAdicionales === undefined ? limpiarAdicionales(input.rol, actual.rolesAdicionales) : limpiarAdicionales(input.rol, input.rolesAdicionales);
  const sinPermiso = permisoSobre(actor, actual.rol, ...actual.rolesAdicionales, input.rol, ...adicionales);
  if (sinPermiso) return { error: sinPermiso };
  if (id === actor.id && (!input.activo || input.rol !== actual.rol)) {
    return { error: "No podés desactivarte ni cambiarte el rol a vos mismo." };
  }
  const nombre = input.nombre.trim();
  if (!nombre) return { error: "Falta el nombre." };
  const em = normalizarEmail(input.email);
  if ("error" in em) return { error: em.error };
  if (actual.passwordHash && !em.email) return { error: "Este usuario entra con contraseña: necesita un email." };
  if (em.email && em.email !== actual.email) {
    const otro = await getUsuarioPorEmail(em.email);
    if (otro && otro.id !== id) return { error: "Ya existe un usuario con ese email." };
  }

  await db.transaction(async (tx) => {
    await tx.update(usuario).set({ nombre, email: em.email, rol: input.rol, rolesAdicionales: adicionales, activo: input.activo }).where(eq(usuario.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "usuario", entidadId: id, campo: "nombre", anterior: actual.nombre, nuevo: nombre },
      { entidad: "usuario", entidadId: id, campo: "email", anterior: actual.email, nuevo: em.email },
      { entidad: "usuario", entidadId: id, campo: "rol", anterior: actual.rol, nuevo: input.rol },
      { entidad: "usuario", entidadId: id, campo: "perfiles adicionales", anterior: actual.rolesAdicionales.join(", ") || null, nuevo: adicionales.join(", ") || null },
      { entidad: "usuario", entidadId: id, campo: "activo", anterior: actual.activo, nuevo: input.activo },
    ]);
  });
  return {};
}

/** Nueva contraseña o PIN (alta de credencial o restablecimiento). Nunca se
 *  guarda el valor en la auditoría. */
export async function cambiarSecretoAdmin(actor: Actor, id: number, secreto: string, tipo: "contraseña" | "PIN"): Promise<Resultado> {
  const actual = await getUsuario(id);
  if (!actual) return { error: "Usuario no encontrado." };
  const sinPermiso = permisoSobre(actor, actual.rol, ...actual.rolesAdicionales);
  if (sinPermiso) return { error: sinPermiso };
  if (tipo === "PIN") {
    const e = validarPin(secreto);
    if (e) return { error: e };
    if (!aceptaPin([actual.rol, ...actual.rolesAdicionales])) return { error: "El PIN es sólo para perfiles de planta." };
  } else {
    const e = validarPassword(secreto);
    if (e) return { error: e };
    if (!actual.email) return { error: "Para entrar con contraseña, primero cargale un email." };
  }
  const hash = await hashSecret(secreto);
  await db.transaction(async (tx) => {
    await tx
      .update(usuario)
      .set(tipo === "PIN" ? { pinHash: hash } : { passwordHash: hash })
      .where(eq(usuario.id, id));
    await registrarCambios(tx, actor.id, [
      { entidad: "usuario", entidadId: id, campo: tipo, anterior: (tipo === "PIN" ? actual.pinHash : actual.passwordHash) ? "(anterior)" : "(sin credencial)", nuevo: "(cambiada)" },
    ]);
  });
  return {};
}
