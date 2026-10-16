"use server";

import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { informarError, marcarAvisoProcesado, marcarAvisoVisto } from "@/lib/data/avisos";

export async function marcarAvisoVistoAction(id: number) {
  const usuario = await getUsuarioActual();
  await marcarAvisoVisto(usuario, id);
  revalidatePath("/", "layout");
}

export async function marcarAvisoProcesadoAction(id: number) {
  const usuario = await getUsuarioActual();
  await marcarAvisoProcesado(usuario, id);
  revalidatePath("/", "layout");
}

export async function informarErrorAction(_p: { error?: string; ok?: string }, fd: FormData): Promise<{ error?: string; ok?: string }> {
  const usuario = await getUsuarioActual();
  const r = await informarError(usuario, {
    descripcion: String(fd.get("descripcion") ?? ""),
    pantalla: String(fd.get("pantalla") ?? ""),
    pedidoId: Number(fd.get("pedidoId")) || null,
  });
  if (r.error) return { error: r.error };
  revalidatePath("/avisos");
  return { ok: "Listo: Supervisión recibió el aviso y lo corrige. No hace falta volver a cargar el dato." };
}
