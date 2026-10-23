"use server";

import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { asignarOperario, guardarEsquema, quitarAsignacion } from "@/lib/data/turnos";
import type { EstadoAccion } from "@/components/form-accion";
import type { Esquema, Turno } from "@/lib/turnos";

function revalidar() {
  revalidatePath("/produccion");
  revalidatePath("/taller");
}

/** Esquema para un día o para toda la semana mostrada. */
export async function guardarEsquemaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const valor = String(fd.get("esquema") ?? "");
  const esquema = valor === "SIMPLE" || valor === "DOBLE" || valor === "TRIPLE" ? (valor as Esquema) : null;
  const fechas = fd.getAll("fecha").map(String);
  const r = await guardarEsquema(u, fechas, esquema);
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: fechas.length > 1 ? "Esquema guardado para la semana." : "Esquema guardado." };
}

export async function asignarOperarioAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const t = String(fd.get("turno") ?? "") as Turno;
  const r = await asignarOperario(u, {
    fecha: String(fd.get("fecha") ?? ""),
    turno: t,
    usuarioId: Number(fd.get("usuarioId")),
    inyectora: String(fd.get("inyectora") ?? "").trim() || null,
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Operario asignado." };
}

export async function quitarAsignacionAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await quitarAsignacion(u, Number(fd.get("id")));
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Asignación quitada." };
}
