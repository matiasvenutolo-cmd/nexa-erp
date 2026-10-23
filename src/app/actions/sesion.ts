"use server";

import { redirect } from "next/navigation";
import { crearSesion, destruirSesion, getUsuarioActual, viaSesion } from "@/lib/session";
import { getUsuario, getUsuarioPorEmail, perfilesDe } from "@/lib/data/usuarios";
import { registrarCambios } from "@/lib/data/auditoria";
import { db } from "@/lib/db/client";
import { verifySecret } from "@/lib/auth/hash";
import { HOME_POR_ROL } from "@/lib/nav";

/** Administración, supervisión y gerencia entran con email + contraseña. */
export async function iniciarSesionStaffAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const usuario = email ? await getUsuarioPorEmail(email) : undefined;
  const ok = usuario?.activo && usuario.passwordHash && (await verifySecret(password, usuario.passwordHash));
  if (!ok || !usuario) {
    redirect("/login?error=credenciales");
  }

  const rol = perfilesDe(usuario, "clave")[0];
  await crearSesion(usuario, { rol, via: "clave" });
  redirect(HOME_POR_ROL[rol]);
}

/** Operario entra eligiendo su nombre de una lista + PIN — pensado para la PC de planta. */
export async function iniciarSesionOperarioAction(formData: FormData) {
  const usuarioId = Number(formData.get("usuarioId"));
  const pin = String(formData.get("pin") ?? "");

  const usuario = usuarioId ? await getUsuario(usuarioId) : undefined;
  const perfiles = usuario ? perfilesDe(usuario, "pin") : [];
  const ok = usuario?.activo && usuario.pinHash && perfiles.length > 0 && (await verifySecret(pin, usuario.pinHash));
  if (!ok || !usuario) {
    redirect("/login?error=pin");
  }

  await crearSesion(usuario, { rol: perfiles[0], via: "pin" });
  redirect(HOME_POR_ROL[perfiles[0]]);
}

/**
 * Cambiar de perfil (ej. Dylan: Retiros de MP → suple al Encargado). Sólo a un
 * perfil que la persona tiene asignado y, si entró con PIN, de planta. Queda
 * en el historial de cambios.
 */
export async function cambiarPerfilAction(formData: FormData) {
  const actual = await getUsuarioActual();
  const via = await viaSesion();
  const rol = String(formData.get("rol") ?? "") as typeof actual.rol;
  const permitidos = perfilesDe(actual, via);
  if (!permitidos.includes(rol)) redirect(HOME_POR_ROL[actual.rol]);
  if (rol !== actual.rol) {
    await registrarCambios(db, actual.id, [
      { entidad: "usuario", entidadId: actual.id, campo: "perfil activo", anterior: actual.rol, nuevo: rol },
    ]);
  }
  await crearSesion(actual, { rol, via });
  redirect(HOME_POR_ROL[rol]);
}

export async function cerrarSesionAction() {
  await destruirSesion();
  redirect("/login");
}
