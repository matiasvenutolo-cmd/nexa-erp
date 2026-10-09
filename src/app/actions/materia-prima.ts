"use server";

import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { ingresarMateriaPrima } from "@/lib/data/materia-prima";

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
