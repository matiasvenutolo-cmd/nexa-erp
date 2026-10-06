"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { ingresarMateriaPrima, retirarMateriaPrima } from "@/lib/data/materia-prima";

export type EstadoForm = { error?: string; ok?: string };

function num(fd: FormData, k: string): number | null {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? null : Number(v);
}

export async function ingresoMpAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const r = await ingresarMateriaPrima(usuario, {
    materiaPrimaId: Number(fd.get("materiaPrimaId")),
    proveedor: String(fd.get("proveedor") ?? ""),
    fechaRecepcion: String(fd.get("fechaRecepcion") ?? ""),
    cantidadKg: num(fd, "cantidadKg") ?? NaN,
    codigoBarra: String(fd.get("codigoBarra") ?? ""),
    conCertificado: fd.get("conCertificado") === "1",
    archivoUrl: String(fd.get("archivoUrl") ?? "") || null,
    ubicacion: String(fd.get("ubicacion") ?? "") || null,
  });
  if (r.error) return { error: r.error };
  revalidatePath("/materia-prima");
  return { ok: `Lote ingresado${r.certificado ? ` con el certificado N° ${r.certificado}` : ""}.` };
}

export async function retiroMpAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const r = await retirarMateriaPrima(usuario, {
    materiaPrimaId: Number(fd.get("materiaPrimaId")),
    loteMpId: num(fd, "loteMpId"),
    cantidadKg: num(fd, "cantidadKg") ?? NaN,
    inyectora: String(fd.get("inyectora") ?? "") || null,
    cicloId: num(fd, "cicloId"),
    entregaId: num(fd, "entregaId"),
    observaciones: String(fd.get("observaciones") ?? "") || null,
  });
  if (r.error) return { error: r.error };
  revalidatePath("/materia-prima");
  revalidatePath("/produccion");
  // Desde un ciclo, se vuelve al ciclo: el paso siguiente es producir y cerrar el día.
  const cicloId = num(fd, "cicloId");
  if (cicloId) redirect(`/produccion/${cicloId}`);
  return { ok: "Retiro registrado." };
}
