"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cerrarCiclo } from "@/lib/data/produccion";
import { getUsuarioActual } from "@/lib/session";
import { puedeCerrarCiclo } from "@/lib/auth/permisos";
import { cerrarTurno, turnoAbiertoDe as vistaTallerDeCiclo } from "@/lib/data/taller";

export type FormState = { error?: string };

function numOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function cerrarCicloAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const usuario = await getUsuarioActual();
  if (!puedeCerrarCiclo(usuario.rol)) return { error: "No tenés permiso para cerrar la producción." };

  const cicloId = Number(fd.get("cicloId"));
  const cerrarPartida = fd.get("cerrarPartida") === "on";
  // Si hay un turno abierto, el cierre de producción también lo cierra (con los mismos golpes).
  const golpes = numOrNull(fd.get("golpesFin"));
  const vista = await vistaTallerDeCiclo(cicloId);
  if (vista && golpes != null) {
    const t = await cerrarTurno(usuario, { cicloId, golpesFin: golpes });
    if (t.error) return { error: t.error };
  }

  const r = await cerrarCiclo(cicloId, {
    golpesFin: numOrNull(fd.get("golpesFin")),
    piezasDescartadas: numOrNull(fd.get("piezasDescartadas")),
    piezasEntregadas: numOrNull(fd.get("piezasEntregadas")),
    coladaKg: fd.get("coladaKg") ? String(fd.get("coladaKg")) : null,
    rebarbaKg: fd.get("rebarbaKg") ? String(fd.get("rebarbaKg")) : null,
    scrapKg: fd.get("scrapKg") ? String(fd.get("scrapKg")) : null,
    cambioCicloCausa: fd.get("cambioCicloCausa") ? String(fd.get("cambioCicloCausa")) : null,
    observaciones: fd.get("observaciones") ? String(fd.get("observaciones")) : null,
    cerrarPartida,
    usuarioId: usuario.id,
  });
  if (r.error) return { error: r.error };

  revalidatePath("/produccion");
  revalidatePath(`/produccion/${cicloId}`);
  redirect(`/produccion/${cicloId}?ok=${encodeURIComponent("Producción cerrada: lo bueno entró a stock en cajas y se registró el consumo de la tolva.")}`);
}
