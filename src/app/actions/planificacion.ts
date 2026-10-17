"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import {
  actualizarTanda,
  cancelarTanda,
  crearTanda,
  iniciarProduccionDeTanda,
  moverTanda,
  postergarTanda,
  quitarPedidosDeTanda,
  type Turno,
} from "@/lib/data/planificacion";
import { crearPresentacion, guardarReceta, quitarRecetaArranque, type ItemRecetaInput } from "@/lib/data/recetas";
import type { EstadoAccion } from "@/components/form-accion";

function num(fd: FormData, k: string): number | null {
  const v = String(fd.get(k) ?? "").trim().replace(",", ".");
  return v === "" ? null : Number(v);
}
function txt(fd: FormData, k: string): string | null {
  return String(fd.get(k) ?? "").trim() || null;
}
function turno(fd: FormData): Turno | null {
  const v = txt(fd, "turno");
  return v === "MANANA" || v === "TARDE" || v === "NOCHE" ? v : null;
}
function revalidar() {
  revalidatePath("/produccion");
  revalidatePath("/taller");
  revalidatePath("/tablero");
}

/** Crear tanda desde un grupo: los renglones marcados con su cantidad. */
export async function crearTandaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const productoId = Number(fd.get("productoId"));
  const lineas = fd
    .getAll("linea")
    .map((v) => Number(v))
    .map((id) => ({ pedidoLineaId: id, cantidad: num(fd, `cantidad_${id}`) ?? 0 }));
  const r = await crearTanda(u, {
    productoId,
    lineas,
    cantidadStock: num(fd, "cantidadStock") ?? 0,
    inyectora: txt(fd, "inyectora"),
    fecha: txt(fd, "fecha"),
    turno: turno(fd),
    usarArranque: fd.get("usarArranque") === "on",
    observaciones: txt(fd, "observaciones"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Tanda planificada: quedó al final de la secuencia. Asignale máquina y turno si todavía no lo hiciste." };
}

export async function actualizarTandaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await actualizarTanda(u, Number(fd.get("id")), {
    inyectora: txt(fd, "inyectora"),
    fecha: txt(fd, "fecha"),
    turno: turno(fd),
    cantidadStock: num(fd, "cantidadStock") ?? 0,
    usarArranque: fd.get("usarArranque") === "on",
    observaciones: txt(fd, "observaciones"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Tanda actualizada." };
}

export async function moverTandaAction(fd: FormData) {
  const u = await getUsuarioActual();
  await moverTanda(u, Number(fd.get("id")), fd.get("direccion") === "arriba" ? "arriba" : "abajo");
  revalidar();
}

export async function postergarTandaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const reactivar = fd.get("reactivar") === "1";
  const r = await postergarTanda(u, Number(fd.get("id")), txt(fd, "motivo"), reactivar);
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: reactivar ? "La tanda vuelve a la secuencia." : "Tanda postergada: sus pedidos siguen reservados para ella." };
}

export async function quitarPedidosAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const ids = fd.getAll("quitar").map(Number);
  const r = await quitarPedidosDeTanda(u, Number(fd.get("id")), ids, txt(fd, "motivo"));
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Los pedidos quitados vuelven a «Por planificar»." };
}

export async function cancelarTandaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await cancelarTanda(u, Number(fd.get("id")), txt(fd, "motivo"));
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Tanda cancelada: sus pedidos vuelven a «Por planificar»." };
}

export async function iniciarTandaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await iniciarProduccionDeTanda(u, Number(fd.get("id")), { golpesInicio: num(fd, "golpesInicio") });
  if (r.error) return { error: r.error };
  revalidar();
  redirect(`/produccion/${r.cicloId}?ok=${encodeURIComponent("Producción iniciada. El operario ya la ve en su pantalla.")}`);
}

// ---------------------------------------------------------------------------
// Recetas
// ---------------------------------------------------------------------------

export async function guardarRecetaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const productoId = Number(fd.get("productoId"));
  const tipo = fd.get("tipo") === "ARRANQUE" ? "ARRANQUE" : "REGIMEN";
  let items: ItemRecetaInput[] = [];
  try {
    items = JSON.parse(String(fd.get("items") ?? "[]"));
  } catch {
    return { error: "No se pudo leer la receta." };
  }
  const r = await guardarReceta(u, productoId, tipo, { items, observaciones: txt(fd, "observaciones"), motivo: txt(fd, "motivo") });
  if (r.error) return { error: r.error };
  revalidatePath("/admin/recetas");
  revalidar();
  return { ok: "Receta guardada. El operario la ve en su próxima carga." };
}

export async function quitarArranqueAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await quitarRecetaArranque(u, Number(fd.get("productoId")), txt(fd, "motivo"));
  if (r.error) return { error: r.error };
  revalidatePath("/admin/recetas");
  return { ok: "Receta de arranque quitada." };
}

export async function crearPresentacionAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const gramos = num(fd, "gramos");
  const tipo = txt(fd, "tipoMp");
  const r = await crearPresentacion(u, {
    nombre: String(fd.get("nombre") ?? ""),
    kg: gramos != null ? gramos / 1000 : NaN,
    materiaPrimaId: num(fd, "materiaPrimaId"),
    tipoMp: tipo === "VIRGEN" || tipo === "MASTER" || tipo === "MOLIENDA" || tipo === "SOBRANTE" ? tipo : null,
  });
  if (r.error) return { error: r.error };
  revalidatePath("/admin/recetas");
  return { ok: "Presentación agregada." };
}

/** Arrastrar y soltar en el calendario: guarda el día y el turno de la tanda. */
export async function moverTandaCalendarioAction(id: number, fecha: string | null, turno: Turno | null): Promise<{ error?: string }> {
  const u = await getUsuarioActual();
  if (fecha != null && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return { error: "Fecha inválida." };
  const r = await actualizarTanda(u, id, { fecha, turno });
  if (r.error) return r;
  revalidar();
  return {};
}
