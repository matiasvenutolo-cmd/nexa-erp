"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  crearPedido,
  avanzarEstadoPedido,
  marcarEntregado,
  cancelarPedido,
  editarPedido,
  cambiarUrgencia,
} from "@/lib/data/pedidos";
import { resolverClienteDelPedido } from "@/lib/data/clientes";
import { crearProductoNuevo } from "@/lib/data/catalogo";
import { getUsuarioActual } from "@/lib/session";
import { puedeCrearPedido, puedeCrearProducto, puedeVerPrecios } from "@/lib/auth/permisos";
import type { FamiliaProducto, TipoProducto } from "@/lib/catalogo-normalizacion";

export type FormState = { error?: string };

type LineaEntrante = {
  productoId: number | null;
  colorTexto: string | null;
  cantidad: number;
  // Presentes sólo cuando la línea pide dar de alta el color como producto
  // nuevo (docs/06-comentarios-produccion.md §5).
  crearProducto?: boolean;
  familia?: FamiliaProducto;
  tipo?: TipoProducto;
  proveedorMasterId?: number;
  masterNombre?: string;
  masterCodigo?: string;
};

/**
 * Alta de pedido. Replica el circuito real: el color sale de una lista del
 * catálogo, así que en el caso normal cada línea queda con su SKU resuelto
 * desde el momento en que se carga — regla 1 de docs/03-plan-release-1.md,
 * nada de re-tipear después.
 */
export async function crearPedidoAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const usuario = await getUsuarioActual();
  // Defensa en profundidad: src/proxy.ts ya bloquea la navegación a esta
  // ruta para quien no gestiona pedidos, pero una mutación no debe confiar
  // sólo en el middleware — ver AGENTS.md regla 2 y src/lib/auth/permisos.ts.
  if (!puedeCrearPedido(usuario.rol)) return { error: "No tenés permiso para cargar pedidos." };

  const fechaPedido = String(fd.get("fechaPedido") ?? "").trim();
  if (!fechaPedido) return { error: "Falta la fecha del pedido." };

  const contacto = String(fd.get("contacto") ?? "").trim() || null;
  const domicilioEntrega = String(fd.get("domicilio") ?? "").trim() || null;

  let lineas: LineaEntrante[];
  try {
    lineas = JSON.parse(String(fd.get("lineas") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer los ítems del pedido." };
  }
  const lineasValidas = lineas.filter((l) => l.cantidad > 0);
  if (lineasValidas.length === 0) return { error: "Agregá al menos un ítem con cantidad." };

  // Cada renglón es UN producto del catálogo: un color de la lista o un color
  // especial que se registra (Definiciones pendientes, respuestas 1 y 6).
  // Nunca un texto libre sin producto.
  if (lineasValidas.some((l) => !l.productoId && !l.crearProducto)) {
    return { error: "Cada ítem tiene que ser un color de la lista o un color especial registrado — elegí el color de cada renglón." };
  }
  const algunaCreaProducto = lineasValidas.some((l) => l.crearProducto && !l.productoId);
  if (algunaCreaProducto && !puedeCrearProducto(usuario.rol)) {
    return { error: "No tenés permiso para registrar colores especiales." };
  }

  const clienteResuelto = await resolverClienteDelPedido({
    clienteId: Number(fd.get("clienteId")) || null,
    nombreNuevo: String(fd.get("clienteNuevo") ?? ""),
    telefono: contacto,
    domicilio: domicilioEntrega,
  });
  if ("error" in clienteResuelto) return { error: clienteResuelto.error };
  const cid = clienteResuelto.id;

  // Antes de crear el pedido: resolver los colores especiales en productos
  // reales del catálogo. Si alguno falla, se corta acá — no queda un pedido
  // a medio crear con una línea rota.
  for (const l of lineasValidas) {
    if (!l.crearProducto || l.productoId) continue;
    if (!l.familia || !l.tipo || !l.proveedorMasterId || !l.colorTexto?.trim()) {
      return { error: "Para un color especial hacen falta el nombre del color y el proveedor del master." };
    }
    const resultado = await crearProductoNuevo(usuario, {
      familia: l.familia,
      tipo: l.tipo,
      colorNombre: l.colorTexto,
      proveedorMasterId: l.proveedorMasterId,
      clienteId: cid,
      masterNombre: l.masterNombre ?? null,
      masterCodigo: l.masterCodigo ?? null,
    });
    if (!resultado.ok) return { error: resultado.error };
    l.productoId = resultado.id;
  }

  const numeroOrden = String(fd.get("numeroOrden") ?? "").trim() || null;
  // Igual que arriba: quien no ve precios en la UI tampoco puede fijarlos
  // mandando el campo a mano.
  const verPrecios = puedeVerPrecios(usuario.rol);
  const total = verPrecios ? String(fd.get("total") ?? "").trim() : "";
  const senia = verPrecios ? String(fd.get("senia") ?? "").trim() : "";
  const metodoPago = verPrecios ? String(fd.get("metodoPago") ?? "").trim() || null : null;
  const numeroComprobante = verPrecios ? String(fd.get("numeroComprobante") ?? "").trim() || null : null;

  const creado = await crearPedido({
    clienteId: cid,
    fechaPedido,
    fechaEntregaPactada: String(fd.get("fechaEntregaPactada") ?? "").trim() || null,
    numeroOrden,
    contacto,
    domicilioEntrega,
    modoEntrega: String(fd.get("modoEntrega") ?? "").trim() || null,
    requiereColocacion: fd.get("requiereColocacion") === "1",
    metodoPago,
    total: total || null,
    senia: senia || null,
    numeroComprobante,
    observaciones: String(fd.get("observaciones") ?? "").trim() || null,
    usuarioId: usuario.id,
    lineas: lineasValidas.map((l) => ({
      productoId: l.productoId,
      colorTexto: l.colorTexto,
      unidadesPedidas: Math.round(l.cantidad),
    })),
  });

  if ("error" in creado) return { error: creado.error };

  revalidatePath("/pedidos");
  redirect(`/pedidos/${creado.id}`);
}

function revalidarPedido(id: number) {
  revalidatePath("/pedidos");
  revalidatePath(`/pedidos/${id}`);
}

export async function pasarAArmadoAction(pedidoId: number) {
  const usuario = await getUsuarioActual();
  if (!puedeCrearPedido(usuario.rol)) return { error: "No tenés permiso para modificar pedidos." };
  const r = await avanzarEstadoPedido(pedidoId, "EN_ARMADO");
  revalidarPedido(pedidoId);
  return r;
}

export async function marcarListoAction(pedidoId: number) {
  const usuario = await getUsuarioActual();
  if (!puedeCrearPedido(usuario.rol)) return { error: "No tenés permiso para modificar pedidos." };
  const r = await avanzarEstadoPedido(pedidoId, "LISTO_PARA_DESPACHAR");
  revalidarPedido(pedidoId);
  return r;
}

export async function marcarEntregadoAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const usuario = await getUsuarioActual();
  if (!puedeCrearPedido(usuario.rol)) return { error: "No tenés permiso para modificar pedidos." };
  const pedidoId = Number(fd.get("pedidoId"));
  const numeroRemito = String(fd.get("numeroRemito") ?? "").trim() || null;
  const r = await marcarEntregado(pedidoId, { numeroRemito, usuarioId: usuario.id });
  revalidarPedido(pedidoId);
  return r;
}

export async function cancelarPedidoAction(pedidoId: number) {
  const usuario = await getUsuarioActual();
  if (!puedeCrearPedido(usuario.rol)) return { error: "No tenés permiso para modificar pedidos." };
  const r = await cancelarPedido(pedidoId);
  revalidarPedido(pedidoId);
  return r;
}

export async function editarPedidoAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const usuario = await getUsuarioActual();
  if (!puedeCrearPedido(usuario.rol)) return { error: "No tenés permiso para modificar pedidos." };

  const pedidoId = Number(fd.get("pedidoId"));
  const verPrecios = puedeVerPrecios(usuario.rol);

  const r = await editarPedido(pedidoId, {
    fechaEntregaPactada: String(fd.get("fechaEntregaPactada") ?? "").trim() || null,
    contacto: String(fd.get("contacto") ?? "").trim() || null,
    domicilioEntrega: String(fd.get("domicilio") ?? "").trim() || null,
    modoEntrega: String(fd.get("modoEntrega") ?? "").trim() || null,
    requiereColocacion: fd.get("requiereColocacion") === "1",
    metodoPago: verPrecios ? String(fd.get("metodoPago") ?? "").trim() || null : undefined,
    total: verPrecios ? String(fd.get("total") ?? "").trim() || null : undefined,
    senia: verPrecios ? String(fd.get("senia") ?? "").trim() || null : undefined,
    numeroComprobante: verPrecios ? String(fd.get("numeroComprobante") ?? "").trim() || null : undefined,
    observaciones: String(fd.get("observaciones") ?? "").trim() || null,
  });
  if (r.error) return r;

  revalidarPedido(pedidoId);
  redirect(`/pedidos/${pedidoId}`);
}

export async function cambiarUrgenciaAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const usuario = await getUsuarioActual();
  const pedidoId = Number(fd.get("pedidoId"));
  const urgente = fd.get("urgente") === "1";
  const r = await cambiarUrgencia(usuario, pedidoId, urgente, String(fd.get("motivo") ?? "").trim() || null);
  if (r.error) return r;
  revalidarPedido(pedidoId);
  revalidatePath("/produccion");
  return {};
}
