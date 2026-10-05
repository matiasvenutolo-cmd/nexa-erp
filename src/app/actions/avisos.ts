"use server";

import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { marcarAvisoProcesado, marcarAvisoVisto } from "@/lib/data/avisos";

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
