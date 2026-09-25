/**
 * Sesión real: cookie httpOnly con un JWT firmado (src/lib/auth/jwt.ts),
 * verificada contra la base en cada lectura de `getUsuarioActual`. Mismo
 * patrón que reiner-erp — ver docs/03-plan-release-1.md paso 2.
 */
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getUsuario, type Usuario } from "@/lib/data/usuarios";
import { firmarSesion, verificarSesion } from "@/lib/auth/jwt";

const COOKIE = "nexa_sesion";
const MAX_AGE_SEG = 60 * 60 * 24 * 30;

export async function crearSesion(usuario: Usuario) {
  const token = await firmarSesion({ usuarioId: usuario.id, rol: usuario.rol });
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
 *  sesión válida o el usuario fue desactivado. */
export const getUsuarioActual = cache(async (): Promise<Usuario> => {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const payload = await verificarSesion(token);
  const usuario = payload ? await getUsuario(payload.usuarioId) : undefined;
  if (!usuario || !usuario.activo) redirect("/login");
  return usuario;
});
