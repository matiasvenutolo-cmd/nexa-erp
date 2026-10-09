/**
 * Vista de precios elegida por el Supervisor (cookie de la sesión del
 * navegador). Para los demás roles no cambia nada: la regla es la de siempre.
 */
import "server-only";
import { cookies } from "next/headers";
import { puedeVerPrecios } from "@/lib/auth/permisos";
import type { Usuario } from "@/lib/data/usuarios";

export const COOKIE_VISTA = "nexa_vista";

export async function vistaCompleta(): Promise<boolean> {
  return (await cookies()).get(COOKIE_VISTA)?.value === "completa";
}

export async function verPrecios(usuario: Pick<Usuario, "rol">): Promise<boolean> {
  return puedeVerPrecios(usuario.rol, usuario.rol === "SUPERVISOR" && (await vistaCompleta()));
}
