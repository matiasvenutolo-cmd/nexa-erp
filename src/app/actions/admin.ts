"use server";

/**
 * Acciones del Panel Admin. No deciden permisos ni escriben auditoría: eso lo
 * hace la capa de servicios (src/lib/data/*), que es la que también usan los
 * tests. Acá sólo se lee el formulario y se vuelve a la pantalla con el
 * resultado.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import type { Resultado } from "@/lib/data/auditoria";
import { actualizarMinMaxMateriaPrima, actualizarMinMaxProducto } from "@/lib/data/stock-config";
import { actualizarParametro } from "@/lib/data/parametros";
import { actualizarDosificacion, crearDosificacion, eliminarExcepcionDosificacion } from "@/lib/data/dosificacion";
import { actualizarFichaColor, crearColorEspecial } from "@/lib/data/colores";
import { actualizarDatosTecnicos } from "@/lib/data/catalogo";
import { actualizarUsuarioAdmin, cambiarSecretoAdmin, crearUsuarioAdmin } from "@/lib/data/usuarios";
import type { usuario } from "@/lib/db/schema";

type Rol = (typeof usuario.$inferSelect)["rol"];

function texto(fd: FormData, k: string): string | null {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : v;
}

function numero(fd: FormData, k: string): number | null {
  const v = texto(fd, k);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function entero(fd: FormData, k: string): number | null {
  const n = numero(fd, k);
  return n == null || Number.isNaN(n) ? null : n;
}

/** Vuelve a la pantalla del panel desde la que se envió el formulario. */
function volver(fd: FormData, r: Resultado, ok: string): never {
  const destino = String(fd.get("volver") ?? "/admin");
  const base = destino.startsWith("/admin") ? destino : "/admin";
  const url = new URL(base, "http://x");
  url.searchParams.delete("ok");
  url.searchParams.delete("error");
  url.searchParams.set(r.error ? "error" : "ok", r.error ?? ok);
  revalidatePath("/", "layout");
  const ancla = String(fd.get("ancla") ?? "");
  redirect(`${url.pathname}${url.search}${ancla ? `#${ancla}` : ""}`);
}

export async function guardarMinMaxProductoAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const r = await actualizarMinMaxProducto(usuario, Number(fd.get("id")), {
    minimo: numero(fd, "minimo"),
    maximo: numero(fd, "maximo"),
    motivo: texto(fd, "motivo"),
  });
  volver(fd, r, "Mínimo y máximo guardados.");
}

export async function guardarMinMaxMateriaPrimaAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const r = await actualizarMinMaxMateriaPrima(usuario, Number(fd.get("id")), {
    minimo: numero(fd, "minimo"),
    maximo: numero(fd, "maximo"),
    motivo: texto(fd, "motivo"),
  });
  volver(fd, r, "Mínimo y máximo guardados.");
}

export async function guardarParametroAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const valor = numero(fd, "valor");
  const r =
    valor == null
      ? { error: "Falta el valor." }
      : await actualizarParametro(usuario, String(fd.get("clave")), valor, texto(fd, "motivo"));
  volver(fd, r, "Parámetro guardado.");
}

export async function crearDosificacionAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const kg = numero(fd, "gPorKgMp");
  const familia = String(fd.get("familia"));
  const r =
    kg == null
      ? { error: "Falta la dosificación." }
      : await crearDosificacion(usuario, {
          familia: familia as "REJILLA" | "CIEGO",
          colorId: entero(fd, "colorId"),
          materiaPrimaBaseId: entero(fd, "materiaPrimaBaseId"),
          gPorKgMp: kg,
          observaciones: texto(fd, "observaciones"),
          motivo: texto(fd, "motivo"),
        });
  volver(fd, r, "Dosificación agregada.");
}

export async function actualizarDosificacionAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const kg = numero(fd, "gPorKgMp");
  const r =
    kg == null
      ? { error: "Falta la dosificación." }
      : await actualizarDosificacion(usuario, Number(fd.get("id")), {
          gPorKgMp: kg,
          materiaPrimaBaseId: entero(fd, "materiaPrimaBaseId"),
          observaciones: texto(fd, "observaciones"),
          motivo: texto(fd, "motivo"),
        });
  volver(fd, r, "Dosificación guardada.");
}

export async function eliminarDosificacionAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const r = await eliminarExcepcionDosificacion(usuario, Number(fd.get("id")), texto(fd, "motivo"));
  volver(fd, r, "Excepción quitada: ese color vuelve a usar el valor base de la familia.");
}

export async function crearColorEspecialAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const r = await crearColorEspecial(usuario, {
    nombre: String(fd.get("nombre") ?? ""),
    clienteId: entero(fd, "clienteId"),
    proveedorMasterId: entero(fd, "proveedorMasterId"),
    masterNombre: texto(fd, "masterNombre"),
    masterCodigo: texto(fd, "masterCodigo"),
    masterMateriaPrimaId: entero(fd, "masterMateriaPrimaId"),
    observaciones: texto(fd, "observaciones"),
  });
  volver(fd, r, "Color especial registrado.");
}

export async function actualizarColorAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const r = await actualizarFichaColor(usuario, Number(fd.get("id")), {
    especial: fd.get("especial") === "1",
    clienteId: entero(fd, "clienteId"),
    proveedorMasterId: entero(fd, "proveedorMasterId"),
    masterNombre: texto(fd, "masterNombre"),
    masterCodigo: texto(fd, "masterCodigo"),
    masterMateriaPrimaId: entero(fd, "masterMateriaPrimaId"),
    observaciones: texto(fd, "observaciones"),
    motivo: texto(fd, "motivo"),
  });
  volver(fd, r, "Color guardado.");
}

export async function crearUsuarioAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const r = await crearUsuarioAdmin(usuario, {
    nombre: String(fd.get("nombre") ?? ""),
    email: texto(fd, "email") ?? undefined,
    rol: String(fd.get("rol")) as Rol,
    secreto: String(fd.get("secreto") ?? ""),
  });
  volver(fd, r, "Usuario creado.");
}

export async function actualizarUsuarioAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const r = await actualizarUsuarioAdmin(usuario, Number(fd.get("id")), {
    nombre: String(fd.get("nombre") ?? ""),
    email: texto(fd, "email"),
    rol: String(fd.get("rol")) as Rol,
    activo: fd.get("activo") === "1",
  });
  volver(fd, r, "Usuario guardado.");
}

export async function cambiarSecretoAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const tipo = fd.get("tipo") === "PIN" ? "PIN" : "contraseña";
  const r = await cambiarSecretoAdmin(usuario, Number(fd.get("id")), String(fd.get("secreto") ?? ""), tipo);
  volver(fd, r, tipo === "PIN" ? "PIN actualizado." : "Contraseña actualizada.");
}

export async function guardarDatosTecnicosAction(fd: FormData) {
  const usuario = await getUsuarioActual();
  const m2 = numero(fd, "m2PorUnidad");
  const kg = numero(fd, "kgPorUnidad");
  const r =
    (m2 != null && Number.isNaN(m2)) || (kg != null && Number.isNaN(kg))
      ? { error: "Valor inválido." }
      : await actualizarDatosTecnicos(usuario, Number(fd.get("id")), { m2PorUnidad: m2, kgPorUnidad: kg, motivo: texto(fd, "motivo") });
  volver(fd, r, "Datos técnicos guardados.");
}
