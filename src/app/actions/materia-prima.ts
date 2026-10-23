"use server";

import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import { ingresarMateriaPrima } from "@/lib/data/materia-prima";
import { ajustarStockMp, alertaCantidad, altaMateriaPrima, editarMateriaPrima, fraccionarMaster, ingresarBolsonMolienda, type TipoMp } from "@/lib/data/stock-mp";
import { fmtPeso, parseCantidadAR } from "@/lib/presentaciones";

export type EstadoForm = { error?: string; ok?: string; confirmar?: string };

/** Cantidad escrita a mano con la convención argentina ("1.500" = mil quinientos). */
function kg(fd: FormData, k: string): number | null {
  const v = String(fd.get(k) ?? "").trim();
  if (v === "") return null;
  return parseCantidadAR(v) ?? NaN;
}
function txt(fd: FormData, k: string): string | null {
  return String(fd.get(k) ?? "").trim() || null;
}
function revalidar() {
  revalidatePath("/materia-prima");
  revalidatePath("/produccion");
}

export async function ingresoMpAction(_prev: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const usuario = await getUsuarioActual();
  const cantidad = kg(fd, "cantidadKg");
  if (cantidad == null || Number.isNaN(cantidad)) return { error: "No se entiende la cantidad. Escribí, por ejemplo, 1.500 (mil quinientos) o 25,5." };
  const materiaPrimaId = Number(fd.get("materiaPrimaId"));
  // Cantidad inusual: se pide confirmar una vez (no se bloquea un dato válido).
  if (fd.get("confirmado") !== String(cantidad)) {
    const alerta = await alertaCantidad(materiaPrimaId, cantidad);
    if (alerta) return { confirmar: alerta };
  }
  const r = await ingresarMateriaPrima(usuario, {
    materiaPrimaId,
    proveedor: String(fd.get("proveedor") ?? ""),
    fechaRecepcion: String(fd.get("fechaRecepcion") ?? ""),
    cantidadKg: cantidad,
    codigoBarra: String(fd.get("codigoBarra") ?? ""),
    conCertificado: fd.get("conCertificado") === "1",
    archivoUrl: txt(fd, "archivoUrl"),
    ubicacion: txt(fd, "ubicacion"),
    compraId: Number(fd.get("compraId")) || null,
  });
  if (r.error) return { error: r.error };
  revalidar();
  if (Number(fd.get("compraId"))) revalidatePath("/compras");
  return { ok: `Ingreso registrado: ${fmtPeso(cantidad)}${r.certificado ? ` con el certificado N° ${r.certificado}` : ""}. Ya figura en el depósito${Number(fd.get("compraId")) ? " y quedó imputado a la compra" : ""}.` };
}

export async function ajusteMpAction(_p: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const u = await getUsuarioActual();
  const valor = kg(fd, "kg");
  if (valor == null || Number.isNaN(valor) || valor <= 0) return { error: "Indicá los kg del ajuste." };
  const signo = fd.get("sentido") === "falta" ? -1 : 1;
  const r = await ajustarStockMp(u, {
    materiaPrimaId: Number(fd.get("materiaPrimaId")),
    ubicacion: fd.get("ubicacion") === "pie" ? "pie" : "deposito",
    deltaKg: signo * valor,
    motivo: String(fd.get("motivo") ?? ""),
    detalle: txt(fd, "detalle"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: `Ajuste registrado (${signo > 0 ? "+" : "−"}${fmtPeso(valor)}).` };
}

export async function bolsonAction(_p: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const u = await getUsuarioActual();
  const valor = kg(fd, "kg");
  if (valor == null || Number.isNaN(valor)) return { error: "Indicá el peso del bolsón." };
  const r = await ingresarBolsonMolienda(u, { materiaPrimaId: Number(fd.get("materiaPrimaId")), kg: valor, observaciones: txt(fd, "observaciones") });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: `Bolsón registrado (${fmtPeso(valor)}). Código para la etiqueta: ${r.codigo}` };
}

export async function fraccionarAction(_p: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const u = await getUsuarioActual();
  const r = await fraccionarMaster(u, {
    materiaPrimaId: Number(fd.get("materiaPrimaId")),
    presentacionId: Number(fd.get("presentacionId")),
    cantidad: Number(fd.get("cantidad")),
    observaciones: txt(fd, "observaciones"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Fraccionamiento registrado. Los kilos del master no cambian: es el mismo material en bolsitas." };
}

export async function altaMpAction(_p: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const u = await getUsuarioActual();
  const r = await altaMateriaPrima(u, {
    codigoInterno: String(fd.get("codigoInterno") ?? ""),
    nombre: String(fd.get("nombre") ?? ""),
    tipo: String(fd.get("tipo") ?? "") as TipoMp,
    proveedor: txt(fd, "proveedor"),
    motivo: txt(fd, "motivo"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Material dado de alta. Ya se puede ingresar, retirar y usar en recetas." };
}

export async function editarMpAction(_p: EstadoForm, fd: FormData): Promise<EstadoForm> {
  const u = await getUsuarioActual();
  const r = await editarMateriaPrima(u, Number(fd.get("id")), { codigoInterno: String(fd.get("codigoInterno") ?? ""), nombre: String(fd.get("nombre") ?? ""), motivo: txt(fd, "motivo") });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Material actualizado. Su historial no cambia." };
}
