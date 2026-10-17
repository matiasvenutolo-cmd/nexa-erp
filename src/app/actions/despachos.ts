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
  const cajaCompleta = fd.get("cajaCompleta") === "1";
  const r = await piquear(usuario, Number(fd.get("despachoId")), {
    codigo: String(fd.get("codigo") ?? ""),
    cantidad: cajaCompleta ? null : cantidadTxt ? Number(cantidadTxt) : null,
    cajaCompleta: fd.has("cajaCompleta") ? cajaCompleta : undefined,
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
  // Vuelve al listado de pedidos con el estado alcanzado (no se queda en la
  // pantalla, donde se podría pasar directo al control final).
  const msg = r.parcial
    ? `Pedido #${pedidoId}: el pedido quedó parcialmente armado. Lo armado pasó a «Listo para despachar»; el resto queda pendiente.`
    : `Pedido #${pedidoId}: el pedido pasó a «Listo para despachar».`;
  redirect(`/pedidos?ok=${encodeURIComponent(msg)}`);
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
