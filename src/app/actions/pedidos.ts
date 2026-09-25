"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { cliente } from "@/lib/db/schema";
import { crearPedido } from "@/lib/data/pedidos";
import { getUsuarioActual } from "@/lib/session";

export type FormState = { error?: string };

type LineaEntrante = {
  productoId: number | null;
  colorTexto: string | null;
  cantidad: number;
};

/**
 * Alta de pedido. Replica el circuito real: el color sale de una lista del
 * catálogo, así que en el caso normal cada línea queda con su SKU resuelto
 * desde el momento en que se carga — regla 1 de docs/03-plan-release-1.md,
 * nada de re-tipear después.
 */
export async function crearPedidoAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const usuario = await getUsuarioActual();

  const fechaPedido = String(fd.get("fechaPedido") ?? "").trim();
  if (!fechaPedido) return { error: "Falta la fecha del pedido." };

  const clienteId = Number(fd.get("clienteId"));
  const clienteNuevo = String(fd.get("clienteNuevo") ?? "").trim();

  let lineas: LineaEntrante[];
  try {
    lineas = JSON.parse(String(fd.get("lineas") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer los ítems del pedido." };
  }
  const lineasValidas = lineas.filter((l) => l.cantidad > 0 && (l.productoId || l.colorTexto));
  if (lineasValidas.length === 0) return { error: "Agregá al menos un ítem con cantidad." };

  let cid = clienteId || undefined;
  if (!cid && clienteNuevo) {
    const [c] = await db
      .insert(cliente)
      .values({ nombre: clienteNuevo })
      .onConflictDoUpdate({ target: cliente.nombre, set: { nombre: clienteNuevo } })
      .returning();
    cid = c.id;
  }
  if (!cid) return { error: "Elegí un cliente o cargá uno nuevo." };

  const numeroOrden = String(fd.get("numeroOrden") ?? "").trim() || null;
  const total = String(fd.get("total") ?? "").trim();
  const senia = String(fd.get("senia") ?? "").trim();

  const { id } = await crearPedido({
    clienteId: cid,
    fechaPedido,
    numeroOrden,
    contacto: String(fd.get("contacto") ?? "").trim() || null,
    domicilioEntrega: String(fd.get("domicilio") ?? "").trim() || null,
    modoEntrega: String(fd.get("modoEntrega") ?? "").trim() || null,
    requiereColocacion: fd.get("requiereColocacion") === "1",
    metodoPago: String(fd.get("metodoPago") ?? "").trim() || null,
    total: total || null,
    senia: senia || null,
    observaciones: String(fd.get("observaciones") ?? "").trim() || null,
    usuarioId: usuario.id,
    lineas: lineasValidas.map((l) => ({
      productoId: l.productoId,
      colorTexto: l.colorTexto,
      unidadesPedidas: Math.round(l.cantidad),
    })),
  });

  revalidatePath("/pedidos");
  redirect(`/pedidos/${id}`);
}
