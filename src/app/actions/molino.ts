"use server";

import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { confirmarMolienda, entregarMolienda, recibirDescarte } from "@/lib/data/molino";
import type { EstadoAccion } from "@/components/form-accion";
import { parseCantidadAR, fmtPeso } from "@/lib/presentaciones";

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;

function revalidar() {
  revalidatePath("/molino");
  revalidatePath("/materia-prima");
}

export async function recibirDescarteAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const kg = parseCantidadAR(String(fd.get("kg") ?? ""));
  if (kg == null) return { error: "No se entiende el peso." };
  const r = await recibirDescarte(u, { origen: String(fd.get("origen") ?? ""), cicloId: Number(fd.get("cicloId")) || null, material: String(fd.get("material") ?? ""), kg, observaciones: txt(fd, "observaciones") });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: `Descarte recibido: ${fmtPeso(kg)}.` };
}

export async function entregarMoliendaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const kg = parseCantidadAR(String(fd.get("kg") ?? ""));
  if (kg == null) return { error: "No se entiende el peso." };
  const r = await entregarMolienda(u, {
    bolson: String(fd.get("bolson") ?? ""),
    materiaPrimaId: Number(fd.get("materiaPrimaId")),
    kg,
    descarteIds: fd.getAll("descarteId").map(Number).filter(Boolean),
    observaciones: txt(fd, "observaciones"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: `Molienda entregada a Materia Prima (${fmtPeso(kg)}): entra al stock cuando MP confirme la recepción.` };
}

export async function confirmarMoliendaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const aceptar = fd.get("aceptar") === "1";
  const kgTxt = txt(fd, "kgRecibidos");
  const kg = kgTxt ? parseCantidadAR(kgTxt) : null;
  if (kgTxt && kg == null) return { error: "No se entiende el peso recibido." };
  const r = await confirmarMolienda(u, Number(fd.get("id")), { aceptar, kgRecibidos: kg, motivo: txt(fd, "motivo") });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: aceptar ? `Molienda recibida: entró al stock general como bolsón ${r.codigo ?? ""}.` : "Entrega rechazada: no entró al stock." };
}
