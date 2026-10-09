"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { crearCiclo, cerrarCiclo, resumenParaCiclo, ultimoCicloDePartida } from "@/lib/data/produccion";
import { getUsuarioActual } from "@/lib/session";
import { puedeCargarProduccion } from "@/lib/auth/permisos";

export type FormState = { error?: string };

function numOrNull(v: FormDataEntryValue | null): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function crearCicloAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const usuario = await getUsuarioActual();
  if (!puedeCargarProduccion(usuario.rol)) return { error: "No tenés permiso para cargar producción." };

  const productoId = Number(fd.get("productoId"));
  if (!productoId) return { error: "Elegí un producto." };
  const inyectora = String(fd.get("inyectora") ?? "").trim();
  const fecha = String(fd.get("fecha") ?? "");
  if (!fecha) return { error: "Falta la fecha." };

  const pedidoIds = fd.getAll("pedidoId").map(Number);
  const cantidades = fd.getAll(`cantidadAsignada`).map(Number);
  const pedidos = pedidoIds
    .map((pedidoId, i) => ({ pedidoId, cantidadAsignada: cantidades[i] ?? 0 }))
    .filter((p) => p.pedidoId && p.cantidadAsignada > 0);

  const creado = await crearCiclo({
    fecha,
    inyectora,
    productoId,
    operarioId: numOrNull(fd.get("operarioId")),
    golpesInicio: numOrNull(fd.get("golpesInicio")),
    piezasPorGolpe: numOrNull(fd.get("piezasPorGolpe")),
    cicloSegundos: fd.get("cicloSegundos") ? String(fd.get("cicloSegundos")) : null,
    modo: fd.get("modo") ? String(fd.get("modo")) : null,
    partidaId: numOrNull(fd.get("partidaId")),
    cantidadDeseada: numOrNull(fd.get("cantidadDeseada")),
    pedidos,
    usuarioId: usuario.id,
  });

  if ("error" in creado) return { error: creado.error };

  revalidatePath("/produccion");
  redirect(`/produccion/${creado.id}`);
}

/** Lo que cambia al elegir un producto en el alta de ciclo: sus partidas
 *  abiertas (para continuar en vez de tipear un número — pregunta 3 de
 *  docs/entregables/NEXA - Definiciones pendientes.md), los golpes de inicio
 *  sugeridos (= golpes fin del último ciclo de esa partida) y los pedidos
 *  abiertos que lo necesitan (§3.1 de docs/06-comentarios-produccion.md). */
export async function datosParaProducto(productoId: number) {
  await getUsuarioActual();
  return resumenParaCiclo(productoId);
}

export async function golpesSugeridos(partidaId: number) {
  const ultimo = await ultimoCicloDePartida(partidaId);
  return ultimo?.golpesFin ?? null;
}

export async function cerrarCicloAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const usuario = await getUsuarioActual();
  if (!puedeCargarProduccion(usuario.rol)) return { error: "No tenés permiso para cargar producción." };

  const cicloId = Number(fd.get("cicloId"));
  const cerrarPartida = fd.get("cerrarPartida") === "on";

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
  redirect(`/produccion/${cicloId}`);
}
