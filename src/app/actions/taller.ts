"use server";

import { revalidatePath } from "next/cache";
import { getUsuarioActual } from "@/lib/session";
import {
  cancelarProduccion,
  cargarReceta,
  cerrarProduccionTaller,
  cerrarTurno,
  iniciarTandaAsignada,
  pausarProduccion,
  registrarNovedad,
  tomarTurno,
} from "@/lib/data/taller";
import { identificarCodigoMp } from "@/lib/data/maquina";
import type { Turno } from "@/lib/data/planificacion";
import type { EstadoAccion } from "@/components/form-accion";
import { fmtPeso, parseCantidadAR } from "@/lib/presentaciones";

function num(fd: FormData, k: string): number | null {
  const v = String(fd.get(k) ?? "").trim();
  if (v === "") return null;
  return parseCantidadAR(v) ?? NaN;
}
function txt(fd: FormData, k: string): string | null {
  return String(fd.get(k) ?? "").trim() || null;
}
function revalidar() {
  revalidatePath("/taller");
  revalidatePath("/produccion");
  revalidatePath("/materia-prima");
}

export async function tomarTurnoAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const t = txt(fd, "turno");
  const recep = txt(fd, "recepcion");
  const r = await tomarTurno(u, {
    cicloId: Number(fd.get("cicloId")),
    turno: t ? (t as Turno) : null,
    operarioNombre: txt(fd, "operarioNombre"),
    golpesInicio: num(fd, "golpesInicio"),
    recepcionOk: recep === "ok" ? true : recep === "diferencia" ? false : null,
    recepcionMotivo: txt(fd, "recepcionMotivo"),
    recepcionDetalle: txt(fd, "recepcionDetalle"),
    token: txt(fd, "token"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Relevo aceptado: ya podés registrar la carga en tolva." };
}

export async function iniciarTandaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const t = txt(fd, "turno");
  const r = await iniciarTandaAsignada(u, {
    tandaId: Number(fd.get("tandaId")),
    golpesInicio: num(fd, "golpesInicio"),
    operarioNombre: txt(fd, "operarioNombre"),
    turno: t ? (t as Turno) : null,
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Producción iniciada. Ahora registrá la carga en tolva." };
}

export async function pausarAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const reanudar = fd.get("reanudar") === "1";
  const r = await pausarProduccion(u, { cicloId: Number(fd.get("cicloId")), motivo: txt(fd, "motivo"), reanudar });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: reanudar ? "Producción reanudada." : "Producción pausada: quedó registrado el motivo." };
}

export async function cancelarProduccionAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await cancelarProduccion(u, { cicloId: Number(fd.get("cicloId")), motivo: txt(fd, "motivo") });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Producción cancelada: la tanda volvió a la planificación." };
}

export async function cargarRecetaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  let ajustes = null;
  const raw = txt(fd, "ajustes");
  if (raw) {
    try {
      ajustes = JSON.parse(raw);
    } catch {
      return { error: "No se pudieron leer las cantidades." };
    }
  }
  let codigos = null;
  const rc = txt(fd, "codigos");
  if (rc) {
    try {
      codigos = JSON.parse(rc);
    } catch {
      return { error: "No se pudieron leer los códigos." };
    }
  }
  const usarPie = fd.get("usarPie") !== "0";
  const r = await cargarReceta(u, {
    cicloId: Number(fd.get("cicloId")),
    tipo: fd.get("tipo") === "ARRANQUE" ? "ARRANQUE" : "REGIMEN",
    ajustes,
    motivoExcepcion: txt(fd, "motivo"),
    token: txt(fd, "token"),
    usarPie,
    codigos,
  });
  if (r.error) return { error: r.error };
  revalidar();
  if (r.repetido) return { ok: "Esa carga ya estaba registrada (no se duplicó)." };
  return { ok: `Carga registrada: ${fmtPeso(r.kg ?? 0)} pasaron ${usarPie ? "del pie de máquina" : "del stock general (retiro a tu nombre)"} a la tolva.` };
}

export async function novedadAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await registrarNovedad(u, {
    cicloId: Number(fd.get("cicloId")),
    tipo: fd.get("tipo") === "INTERRUPCION" ? "INTERRUPCION" : "NO_CARGA",
    motivo: String(fd.get("motivo") ?? ""),
    detalle: txt(fd, "detalle"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Quedó registrado para el Encargado y para el turno siguiente." };
}

export async function cerrarTurnoAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const golpes = num(fd, "golpesFin");
  if (golpes == null) return { error: "Anotá los golpes que marca la máquina." };
  const r = await cerrarTurno(u, {
    cicloId: Number(fd.get("cicloId")),
    golpesFin: golpes,
    descarteKg: num(fd, "descarteKg"),
    motivoInterrupcion: txt(fd, "motivoInterrupcion"),
    observaciones: txt(fd, "observaciones"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: `Turno cerrado${r.piezas != null ? `: ${r.piezas} piezas en el turno` : ""}. El siguiente operario lo ve al entrar.` };
}

export async function cerrarProduccionTallerAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await cerrarProduccionTaller(u, {
    cicloId: Number(fd.get("cicloId")),
    golpesFin: num(fd, "golpesFin"),
    descarteKg: num(fd, "descarteKg"),
    rebarbaKg: num(fd, "rebarbaKg"),
    scrapKg: num(fd, "scrapKg"),
    cerrarPartida: fd.get("cerrarPartida") === "on",
    sobrante: num(fd, "sobranteKg") && Number(fd.get("sobranteMpId")) ? { kg: num(fd, "sobranteKg")!, materiaPrimaDestinoId: Number(fd.get("sobranteMpId")) } : null,
  });
  if (r.error) return { error: r.error };
  revalidar();
  revalidatePath("/catalogo");
  return { ok: `Producción cerrada: ${r.piezasAStock} piezas entraron a stock.` };
}

/** Lectura del código de la bolsa: confirma material, lote y certificado. */
export async function leerCodigoTallerAction(codigo: string, productoNumero: string | null) {
  await getUsuarioActual();
  return identificarCodigoMp(codigo, productoNumero);
}
