"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import {
  anularDespacho,
  confirmarControlFinal,
  confirmarPrimerControl,
  iniciarDespacho,
  piquear,
  registrarRemitoLegal,
} from "@/lib/data/despachos";

export type EstadoForm = { error?: string; ok?: string; alerta?: string };

function revalidar(pedidoId: number) {
  revalidatePath("/pedidos");
  revalidatePath(`/pedidos/${pedidoId}`);
  revalidatePath(`/pedidos/${pedidoId}/despacho`);
  revalidatePath("/produccion");
  revalidatePath("/avisos");
}

export async function iniciarDespachoAction(pedidoId: number): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const r = await iniciarDespacho(usuario, pedidoId);
  if (r.error) return { error: r.error };
  revalidar(pedidoId);
  redirect(`/pedidos/${pedidoId}/despacho`);
}

export async function piquearAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const pedidoId = Number(fd.get("pedidoId"));
  const cantidadTxt = String(fd.get("cantidad") ?? "").trim();
  const r = await piquear(usuario, Number(fd.get("despachoId")), {
    codigo: String(fd.get("codigo") ?? ""),
    cantidad: cantidadTxt ? Number(cantidadTxt) : null,
  });
  revalidar(pedidoId);
  return { error: r.error, ok: r.ok, alerta: r.alerta };
}

export async function primerControlAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const pedidoId = Number(fd.get("pedidoId"));
  const r = await confirmarPrimerControl(usuario, Number(fd.get("despachoId")), String(fd.get("observaciones") ?? ""));
  if (r.error) return { error: r.error };
  revalidar(pedidoId);
  return { ok: "Primer control registrado. El pedido quedó listo para despachar y se avisó a ventas." };
}

export async function controlFinalAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const pedidoId = Number(fd.get("pedidoId"));
  const r = await confirmarControlFinal(usuario, Number(fd.get("despachoId")), String(fd.get("observaciones") ?? ""));
  if (r.error) return { error: r.error };
  revalidar(pedidoId);
  redirect(`/pedidos/${pedidoId}?entregado=${encodeURIComponent(r.remito ?? "")}`);
}

export async function anularDespachoAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const pedidoId = Number(fd.get("pedidoId"));
  const r = await anularDespacho(usuario, Number(fd.get("despachoId")), String(fd.get("motivo") ?? ""));
  if (r.error) return { error: r.error };
  revalidar(pedidoId);
  redirect(`/pedidos/${pedidoId}`);
}

export async function remitoLegalAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const pedidoId = Number(fd.get("pedidoId"));
  const r = await registrarRemitoLegal(usuario, Number(fd.get("despachoId")), String(fd.get("numero") ?? ""));
  if (r.error) return { error: r.error };
  revalidar(pedidoId);
  return { ok: "Remito legal registrado." };
}
