"use server";

import { revalidatePath } from "next/cache";
import { corregirStockManual } from "@/lib/data/stock";
import { getUsuarioActual } from "@/lib/session";
import { puedeCrearPedido } from "@/lib/auth/permisos";

export type FormState = { error?: string; ok?: boolean };

/** Corrección manual de stock — mismo criterio de quién puede que el resto
 *  de la gestión de pedidos/catálogo (src/lib/auth/permisos.ts). */
export async function corregirStockAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const usuario = await getUsuarioActual();
  if (!puedeCrearPedido(usuario.rol)) return { error: "No tenés permiso para corregir stock." };

  const productoId = Number(fd.get("productoId"));
  const delta = Number(fd.get("delta"));
  const motivo = String(fd.get("motivo") ?? "");
  if (!productoId) return { error: "Elegí un producto." };
  if (!Number.isFinite(delta)) return { error: "La cantidad no es válida." };

  const r = await corregirStockManual({ productoId, delta, motivo, usuarioId: usuario.id });
  if (r.error) return r;

  revalidatePath("/catalogo");
  revalidatePath("/catalogo/movimientos");
  return { ok: true };
}
