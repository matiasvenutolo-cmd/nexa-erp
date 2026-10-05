"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { analizarReclamo, cerrarReclamo, crearReclamo, enviarInformeGerencia, type MotivoDevolucion } from "@/lib/data/reclamos";

export type EstadoForm = { error?: string; ok?: string };

export async function crearReclamoAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const motivo = String(fd.get("motivoDevolucion") ?? "");
  const r = await crearReclamo(usuario, {
    pedidoId: Number(fd.get("pedidoId")),
    descripcion: String(fd.get("descripcion") ?? ""),
    motivoDevolucion: motivo ? (motivo as MotivoDevolucion) : null,
    cajaCodigo: String(fd.get("cajaCodigo") ?? "") || null,
  });
  if (r.error) return { error: r.error };
  revalidatePath("/reclamos");
  redirect(`/reclamos/${r.id}`);
}

function revalidar(id: number) {
  revalidatePath("/reclamos");
  revalidatePath(`/reclamos/${id}`);
  revalidatePath("/", "layout");
}

export async function analizarReclamoAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const id = Number(fd.get("id"));
  const r = await analizarReclamo(usuario, id, {
    causa: String(fd.get("causa") ?? ""),
    solucion: String(fd.get("solucion") ?? ""),
    observaciones: String(fd.get("observaciones") ?? ""),
  });
  if (r.error) return { error: r.error };
  revalidar(id);
  return { ok: "Análisis guardado en el historial." };
}

export async function cerrarReclamoAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const id = Number(fd.get("id"));
  const r = await cerrarReclamo(usuario, id, String(fd.get("observaciones") ?? ""));
  if (r.error) return { error: r.error };
  revalidar(id);
  return { ok: "Reclamo cerrado." };
}

export async function informeGerenciaAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const id = Number(fd.get("id"));
  const r = await enviarInformeGerencia(usuario, id);
  if (r.error) return { error: r.error };
  revalidar(id);
  return { ok: "Informe enviado a gerencia: le aparece en sus avisos." };
}
