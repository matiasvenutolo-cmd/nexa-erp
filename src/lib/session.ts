/**
 * Sesión real: cookie httpOnly con un JWT firmado (src/lib/auth/jwt.ts),
 * verificada contra la base en cada lectura de `getUsuarioActual`. Mismo
 * patrón que reiner-erp — ver docs/03-plan-release-1.md paso 2.
 */
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUsuario, perfilesDe, type Usuario } from "@/lib/data/usuarios";
import { firmarSesion, verificarSesion, type SesionPayload } from "@/lib/auth/jwt";

const COOKIE = "nexa_sesion";
const MAX_AGE_SEG = 60 * 60 * 24 * 30;

export async function crearSesion(usuario: Usuario, opciones: { rol?: Usuario["rol"]; via?: SesionPayload["via"] } = {}) {
  const token = await firmarSesion({ usuarioId: usuario.id, rol: opciones.rol ?? usuario.rol, via: opciones.via ?? "clave" });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEG,
  });
}

export async function destruirSesion() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

/** Sesión + usuario real, cacheado por render. Redirige a /login si no hay
 *  sesión válida o el usuario fue desactivado.
 *
 *  `rol` es el perfil ACTIVO de la sesión, verificado contra la base: sólo
 *  vale si sigue siendo uno de los perfiles de la persona (y, si entró con
 *  PIN, uno de planta). Si no, vuelve a su perfil principal. Así todas las
 *  pantallas y acciones siguen usando `usuario.rol` sin cambios. */
export const getUsuarioActual = cache(async (): Promise<Usuario & { rolPrincipal: Usuario["rol"] }> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const payload = await verificarSesion(token);
  const usuario = payload ? await getUsuario(payload.usuarioId) : undefined;
  if (!usuario || !usuario.activo || !payload) redirect("/login");
  const permitidos = perfilesDe(usuario, payload.via ?? "clave");
  if (permitidos.length === 0) redirect("/login");
  const rol = permitidos.includes(payload.rol) ? payload.rol : permitidos[0];
  return { ...usuario, rol, rolPrincipal: usuario.rol };
});

/** Cómo entró la sesión actual (PIN o contraseña). */
export async function viaSesion(): Promise<"clave" | "pin"> {
  const jar = await cookies();
  const payload = await verificarSesion(jar.get(COOKIE)?.value);
  return payload?.via ?? "clave";
}
