"use server";

import { redirect } from "next/navigation";
import { crearSesion, destruirSesion } from "@/lib/session";
import { getUsuario, getUsuarioPorEmail } from "@/lib/data/usuarios";
import { verifySecret } from "@/lib/auth/hash";
import { HOME_POR_ROL } from "@/lib/nav";

/** Administración, supervisión y gerencia entran con email + contraseña. */
export async function iniciarSesionStaffAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const usuario = email ? await getUsuarioPorEmail(email) : undefined;
  const ok =
    usuario?.activo && usuario.rol !== "OPERARIO" && (await verifySecret(password, usuario.passwordHash));
  if (!ok || !usuario) {
    redirect("/login?error=credenciales");
  }

  await crearSesion(usuario);
  redirect(HOME_POR_ROL[usuario.rol]);
}

/** Operario entra eligiendo su nombre de una lista + PIN — pensado para la PC de planta. */
export async function iniciarSesionOperarioAction(formData: FormData) {
  const usuarioId = Number(formData.get("usuarioId"));
  const pin = String(formData.get("pin") ?? "");

  const usuario = usuarioId ? await getUsuario(usuarioId) : undefined;
  const ok = usuario?.activo && usuario.rol === "OPERARIO" && (await verifySecret(pin, usuario.pinHash));
  if (!ok || !usuario) {
    redirect("/login?error=pin");
  }

  await crearSesion(usuario);
  redirect(HOME_POR_ROL[usuario.rol]);
}

export async function cerrarSesionAction() {
  await destruirSesion();
  redirect("/login");
}
