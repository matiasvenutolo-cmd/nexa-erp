"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import {
  cargarEnTolva,
  cerrarRetiro,
  devolverADeposito,
  identificarCodigoMp,
  registrarRetiroMaquina,
  registrarSobrante,
  type LineaRetiroInput,
} from "@/lib/data/maquina";
import { anularLineaRetiro, anularMovimientoMaquina, corregirCierreCiclo, corregirIngresoLote, type CorreccionCierre } from "@/lib/data/correcciones";

export type EstadoMaquina = { error?: string; ok?: string };

function num(fd: FormData, k: string): number | null {
  const v = String(fd.get(k) ?? "").trim().replace(",", ".");
  return v === "" ? null : Number(v);
}
function txt(fd: FormData, k: string): string | null {
  return String(fd.get(k) ?? "").trim() || null;
}

function revalidar(cicloId?: number | null, retiroId?: number | null) {
  revalidatePath("/materia-prima");
  revalidatePath("/produccion");
  if (cicloId) revalidatePath(`/produccion/${cicloId}`);
  if (retiroId) revalidatePath(`/materia-prima/retiros/${retiroId}`);
}

export async function identificarCodigoAction(codigo: string, productoNumero: string | null) {
  await getUsuarioActual();
  return identificarCodigoMp(codigo, productoNumero);
}

export async function registrarRetiroAction(_prev: EstadoMaquina, fd: FormData): Promise<EstadoMaquina> {
  const usuario = await getUsuarioActual();
  let lineas: LineaRetiroInput[] = [];
  try {
    lineas = JSON.parse(String(fd.get("lineas") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer los materiales del formulario." };
  }
  const cicloId = num(fd, "cicloId");
  const r = await registrarRetiroMaquina(usuario, {
    cicloId,
    inyectora: txt(fd, "inyectora"),
    operarioId: num(fd, "operarioId"),
    entregaId: num(fd, "entregaId"),
    piezasPrevistas: num(fd, "piezasPrevistas"),
    observaciones: txt(fd, "observaciones"),
    lineas,
    token: txt(fd, "token"),
  });
  if (r.error) return { error: r.error };
  revalidar(cicloId, r.id);
  redirect(`/materia-prima/retiros/${r.id}`);
}

export async function cargarTolvaAction(_prev: EstadoMaquina, fd: FormData): Promise<EstadoMaquina> {
  const usuario = await getUsuarioActual();
  const cicloId = num(fd, "cicloId");
  const r = await cargarEnTolva(usuario, {
    retiroMpId: num(fd, "retiroMpId") ?? 0,
    cantidadKg: num(fd, "cantidadKg") ?? NaN,
    cicloId: cicloId ?? 0,
    observaciones: txt(fd, "observaciones"),
    token: txt(fd, "token"),
  });
  if (r.error) return { error: r.error };
  revalidar(cicloId, num(fd, "retiroMaquinaId"));
  return { ok: r.repetido ? "Esa carga ya estaba registrada." : "Carga en tolva registrada." };
}

export async function devolverAction(_prev: EstadoMaquina, fd: FormData): Promise<EstadoMaquina> {
  const usuario = await getUsuarioActual();
  const r = await devolverADeposito(usuario, {
    retiroMpId: num(fd, "retiroMpId") ?? 0,
    cantidadKg: num(fd, "cantidadKg") ?? NaN,
    observaciones: txt(fd, "observaciones"),
    token: txt(fd, "token"),
  });
  if (r.error) return { error: r.error };
  revalidar(num(fd, "cicloId"), num(fd, "retiroMaquinaId"));
  return { ok: r.repetido ? "Esa devolución ya estaba registrada." : "Devolución al depósito registrada." };
}

export async function sobranteAction(_prev: EstadoMaquina, fd: FormData): Promise<EstadoMaquina> {
  const usuario = await getUsuarioActual();
  const retiroMaquinaId = num(fd, "retiroMaquinaId") ?? 0;
  const r = await registrarSobrante(usuario, {
    retiroMaquinaId,
    materiaPrimaDestinoId: num(fd, "materiaPrimaDestinoId") ?? 0,
    cantidadKg: num(fd, "cantidadKg") ?? NaN,
    observaciones: txt(fd, "observaciones"),
    token: txt(fd, "token"),
  });
  if (r.error) return { error: r.error };
  revalidar(num(fd, "cicloId"), retiroMaquinaId);
  return { ok: r.repetido ? "Ese sobrante ya estaba registrado." : "Sobrante registrado e ingresado al depósito." };
}

export async function cerrarRetiroAction(_prev: EstadoMaquina, fd: FormData): Promise<EstadoMaquina> {
  const usuario = await getUsuarioActual();
  const retiroMaquinaId = num(fd, "retiroMaquinaId") ?? 0;
  const justificaciones: Record<number, string> = {};
  for (const [k, v] of fd.entries()) {
    const m = /^justificacion_(\d+)$/.exec(k);
    if (m && String(v).trim()) justificaciones[Number(m[1])] = String(v);
  }
  const r = await cerrarRetiro(usuario, retiroMaquinaId, justificaciones);
  if (r.error) return { error: r.error };
  revalidar(num(fd, "cicloId"), retiroMaquinaId);
  return { ok: "Retiro conciliado y cerrado." };
}

// --- Correcciones de Supervisión -------------------------------------------

export async function anularLineaAction(_prev: EstadoMaquina, fd: FormData): Promise<EstadoMaquina> {
  const usuario = await getUsuarioActual();
  const r = await anularLineaRetiro(usuario, num(fd, "retiroMpId") ?? 0, txt(fd, "motivo"));
  if (r.error) return { error: r.error };
  revalidar(num(fd, "cicloId"), num(fd, "retiroMaquinaId"));
  return { ok: "Línea anulada: el material volvió al depósito." };
}

export async function anularMovimientoAction(_prev: EstadoMaquina, fd: FormData): Promise<EstadoMaquina> {
  const usuario = await getUsuarioActual();
  const r = await anularMovimientoMaquina(usuario, num(fd, "movimientoId") ?? 0, txt(fd, "motivo"));
  if (r.error) return { error: r.error };
  revalidar(num(fd, "cicloId"), num(fd, "retiroMaquinaId"));
  return { ok: "Movimiento anulado y regularizado." };
}

export async function corregirCicloAction(_prev: EstadoMaquina, fd: FormData): Promise<EstadoMaquina> {
  const usuario = await getUsuarioActual();
  const cicloId = num(fd, "cicloId") ?? 0;
  const cambios: CorreccionCierre = {};
  const enteros = ["golpesFin", "piezasDescartadas", "piezasEntregadas"] as const;
  for (const k of enteros) if (fd.has(k)) cambios[k] = num(fd, k);
  for (const k of ["coladaKg", "rebarbaKg", "scrapKg", "observaciones"] as const) if (fd.has(k)) cambios[k] = txt(fd, k);
  const r = await corregirCierreCiclo(usuario, cicloId, cambios, txt(fd, "motivo"));
  if (r.error) return { error: r.error };
  revalidar(cicloId);
  return { ok: "Cierre corregido y auditado." };
}

export async function corregirLoteAction(_prev: EstadoMaquina, fd: FormData): Promise<EstadoMaquina> {
  const usuario = await getUsuarioActual();
  const r = await corregirIngresoLote(usuario, num(fd, "loteId") ?? 0, num(fd, "cantidadKg") ?? NaN, txt(fd, "motivo"));
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Ingreso del lote corregido y auditado." };
}
