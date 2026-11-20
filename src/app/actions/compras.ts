"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { actualizarCompra, ejecutarCompra, ESTADOS_COMPRA, MONEDAS, solicitarCompra, type EstadoCompra, type Moneda } from "@/lib/data/compras";
import { guardarProveedor } from "@/lib/data/proveedores";
import type { EstadoAccion } from "@/components/form-accion";
import { parseCantidadAR } from "@/lib/presentaciones";

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim() || null;

function revalidar() {
  revalidatePath("/compras");
  revalidatePath("/materia-prima");
  revalidatePath("/tablero");
}

/** Número escrito a mano (1.500,50). Vacío → null; ilegible → NaN. */
function num(fd: FormData, k: string): number | null {
  const v = txt(fd, k);
  if (v == null) return null;
  return parseCantidadAR(v) ?? NaN;
}
const moneda = (fd: FormData): Moneda => ((MONEDAS as readonly string[]).includes(String(fd.get("moneda"))) ? (String(fd.get("moneda")) as Moneda) : "ARS");

export async function solicitarCompraAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const cantidad = parseCantidadAR(String(fd.get("cantidad") ?? fd.get("cantidadKg") ?? ""));
  if (cantidad == null) return { error: "No se entiende la cantidad: escribí, por ejemplo, 1.500 o 25,5." };
  // Se pide en kg o en gramos (reunión 20/11/2026); la compra se guarda en kg.
  const kg = fd.get("unidad") === "g" ? Math.round(cantidad) / 1000 : cantidad;
  const r = await solicitarCompra(u, { materiaPrimaId: Number(fd.get("materiaPrimaId")), cantidadKg: kg, observaciones: txt(fd, "observaciones") });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Pedido enviado: Compras recibe el aviso." };
}

export async function ejecutarCompraAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const kg = num(fd, "cantidadKg");
  const precio = num(fd, "precioKg");
  const total = num(fd, "montoTotal");
  if ([kg, precio, total].some((x) => Number.isNaN(x))) return { error: "No se entiende algún número: usá punto para miles y coma para decimales." };
  const r = await ejecutarCompra(u, Number(fd.get("id")), {
    proveedorId: Number(fd.get("proveedorId")) || 0,
    cantidadKg: kg ?? undefined,
    precioKg: precio,
    montoTotal: total,
    moneda: moneda(fd),
    fechaEntregaEstimada: txt(fd, "fechaEntregaEstimada"),
    numeroOc: txt(fd, "numeroOc"),
    estado: fd.get("estado") === "COMPRADO" ? "COMPRADO" : "PEDIDO",
    observaciones: txt(fd, "observaciones"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Compra ejecutada: ya figura en Estado de compras." };
}

export async function actualizarCompraAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const estado = String(fd.get("estado") ?? "") as EstadoCompra;
  const kg = num(fd, "cantidadKg");
  const precio = num(fd, "precioKg");
  const total = num(fd, "montoTotal");
  if ([kg, precio, total].some((x) => Number.isNaN(x))) return { error: "No se entiende algún número: usá punto para miles y coma para decimales." };
  const conMontos = fd.has("precioKg") || fd.has("montoTotal");
  const r = await actualizarCompra(u, Number(fd.get("id")), {
    estado: ESTADOS_COMPRA.includes(estado) || estado === "CANCELADA" ? estado : undefined,
    fechaEntregaEstimada: fd.has("fechaEntregaEstimada") ? txt(fd, "fechaEntregaEstimada") : undefined,
    proveedorId: Number(fd.get("proveedorId")) || undefined,
    precioKg: conMontos ? precio : undefined,
    montoTotal: conMontos ? total : undefined,
    moneda: fd.has("moneda") ? moneda(fd) : undefined,
    numeroOc: fd.has("numeroOc") ? txt(fd, "numeroOc") : undefined,
    cantidadKg: kg ?? undefined,
    observaciones: fd.has("observaciones") ? txt(fd, "observaciones") : undefined,
    motivo: txt(fd, "motivo"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: estado === "CANCELADA" ? "Pedido descartado." : "Compra actualizada." };
}

export async function guardarProveedorAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const id = Number(fd.get("id")) || null;
  const r = await guardarProveedor(u, id, {
    nombre: String(fd.get("nombre") ?? ""),
    cuit: txt(fd, "cuit"),
    contacto: txt(fd, "contacto"),
    telefono: txt(fd, "telefono"),
    email: txt(fd, "email"),
    direccion: txt(fd, "direccion"),
    condicionPago: txt(fd, "condicionPago"),
    observaciones: txt(fd, "observaciones"),
    activo: id == null ? true : fd.get("activo") === "1",
  });
  if (r.error) return { error: r.error };
  revalidar();
  if (id == null) redirect(`/compras/proveedores/${r.id}`);
  revalidatePath(`/compras/proveedores/${id}`);
  return { ok: "Ficha guardada." };
}
