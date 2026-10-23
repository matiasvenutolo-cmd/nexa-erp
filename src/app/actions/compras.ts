"use server";

import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { actualizarCompra, crearCompra, ESTADOS_COMPRA, type EstadoCompra } from "@/lib/data/compras";
import type { EstadoAccion } from "@/components/form-accion";
import { parseCantidadAR } from "@/lib/presentaciones";

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;

function revalidar() {
  revalidatePath("/compras");
  revalidatePath("/materia-prima");
  revalidatePath("/tablero");
}

export async function crearCompraAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const kg = parseCantidadAR(String(fd.get("cantidadKg") ?? ""));
  if (kg == null) return { error: "No se entiende la cantidad: usá punto para miles y coma para decimales." };
  const estado = String(fd.get("estado") ?? "PEDIDO") as EstadoCompra;
  const r = await crearCompra(u, {
    materiaPrimaId: Number(fd.get("materiaPrimaId")),
    proveedor: txt(fd, "proveedor"),
    cantidadKg: kg,
    fechaPedido: String(fd.get("fechaPedido") ?? ""),
    fechaEntregaEstimada: txt(fd, "fechaEntregaEstimada"),
    numeroOc: txt(fd, "numeroOc"),
    estado: ESTADOS_COMPRA.includes(estado) ? estado : "PEDIDO",
    observaciones: txt(fd, "observaciones"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: `Compra #${r.id} registrada.` };
}

export async function actualizarCompraAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const estado = String(fd.get("estado") ?? "") as EstadoCompra;
  const cant = txt(fd, "cantidadKg");
  const kg = cant == null ? undefined : parseCantidadAR(cant);
  if (kg === null) return { error: "No se entiende la cantidad." };
  const r = await actualizarCompra(u, Number(fd.get("id")), {
    estado: ESTADOS_COMPRA.includes(estado) ? estado : undefined,
    fechaEntregaEstimada: txt(fd, "fechaEntregaEstimada"),
    proveedor: txt(fd, "proveedor"),
    numeroOc: txt(fd, "numeroOc"),
    cantidadKg: kg,
    observaciones: txt(fd, "observaciones"),
    motivo: txt(fd, "motivo"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Compra actualizada." };
}
