"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { puedeElegirVistaPrecios } from "@/lib/auth/permisos";
import { COOKIE_VISTA } from "@/lib/vista";

/** El Supervisor alterna entre la vista sin precios y la vista completa. */
export async function cambiarVistaAction() {
  const usuario = await getUsuarioActual();
  if (!puedeElegirVistaPrecios(usuario.rol)) return;
  const jar = await cookies();
  const completa = jar.get(COOKIE_VISTA)?.value === "completa";
  jar.set(COOKIE_VISTA, completa ? "sin-precios" : "completa", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
  revalidatePath("/", "layout");
}
