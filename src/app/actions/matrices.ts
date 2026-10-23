"use server";

import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { actualizarIntervencion, programarIntervencion, type EstadoIntervencion, type TipoIntervencion } from "@/lib/data/matrices";
import type { EstadoAccion } from "@/components/form-accion";
import type { Turno } from "@/lib/turnos";

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;
const turno = (fd: FormData): Turno | null => {
  const v = txt(fd, "turno");
  return v === "MANANA" || v === "TARDE" || v === "NOCHE" ? v : null;
};

function revalidar() {
  revalidatePath("/matrices");
  revalidatePath("/produccion");
}

export async function programarIntervencionAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await programarIntervencion(u, {
    tipo: String(fd.get("tipo")) as TipoIntervencion,
    matriz: String(fd.get("matriz") ?? ""),
    matrizAnterior: txt(fd, "matrizAnterior"),
    inyectora: txt(fd, "inyectora"),
    fechaProgramada: String(fd.get("fechaProgramada") ?? ""),
    turno: turno(fd),
    responsableId: Number(fd.get("responsableId")) || null,
    descripcion: txt(fd, "descripcion"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Trabajo programado: el Encargado lo ve en la planificación." };
}

export async function actualizarIntervencionAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const estado = txt(fd, "estado") as EstadoIntervencion | null;
  const r = await actualizarIntervencion(u, Number(fd.get("id")), {
    estado: estado ?? undefined,
    fechaProgramada: txt(fd, "fechaProgramada") ?? undefined,
    turno: fd.has("turno") ? turno(fd) : undefined,
    responsableId: fd.has("responsableId") ? Number(fd.get("responsableId")) || null : undefined,
    observaciones: fd.has("observaciones") ? txt(fd, "observaciones") : undefined,
    motivo: txt(fd, "motivo"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Trabajo actualizado." };
}
