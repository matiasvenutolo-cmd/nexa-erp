"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import {
  cancelarProduccion,
  cargarReceta,
  cerrarProduccionTaller,
  cerrarTurno,
  iniciarTandaAsignada,
  pausarProduccion,
  pedirMaterial,
  avisarPedidoMaterial,
  descartarPedidoMaterial,
  registrarLimpieza,
  registrarReimpresion,
  revisarTurno,
  registrarNovedad,
  tomarTurno,
} from "@/lib/data/taller";
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
  return { ok: "Recibiste la máquina." };
}

export async function iniciarTandaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const t = txt(fd, "turno");
  const r = await iniciarTandaAsignada(u, {
    tandaId: Number(fd.get("tandaId")),
    golpesInicio: num(fd, "golpesInicio"),
    operarioNombre: txt(fd, "operarioNombre"),
    turno: t ? (t as Turno) : null,
    motivo: txt(fd, "motivo"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Producción arrancada." };
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
  const r = await cargarReceta(u, {
    cicloId: Number(fd.get("cicloId")),
    tipo: fd.get("tipo") === "ARRANQUE" ? "ARRANQUE" : "REGIMEN",
    ajustes,
    motivoExcepcion: txt(fd, "motivo"),
    token: txt(fd, "token"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  if (r.repetido) return { ok: "Esa carga ya estaba registrada (no se duplicó)." };
  return { ok: `Carga registrada: ${fmtPeso(r.kg ?? 0)} pasaron del pie de máquina a la tolva.` };
}

/** Reimpresión de una etiqueta: queda en el historial con el motivo y no
 *  cambia el stock (imprime el mismo código). */
export async function reimprimirEtiquetaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await registrarReimpresion(u, Number(fd.get("cajaId")), txt(fd, "motivo"));
  if (r.error) return { error: r.error };
  redirect(`/taller/etiquetas?cajas=${Number(fd.get("cajaId"))}${Number(fd.get("cicloId")) ? `&volver=produccion-${Number(fd.get("cicloId"))}` : ""}`);
}

/** Menú Etiquetas: reimprime varias cajas de una producción con un mismo motivo. */
export async function reimprimirEtiquetasAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const ids = fd.getAll("caja").map(Number).filter(Boolean);
  if (ids.length === 0) return { error: "Tildá las cajas que querés reimprimir." };
  for (const id of ids) {
    const r = await registrarReimpresion(u, id, txt(fd, "motivo"));
    if (r.error) return { error: r.error };
  }
  redirect(`/taller/etiquetas?cajas=${ids.join(",")}&volver=menu`);
}

export async function revisarTurnoAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await revisarTurno(u, Number(fd.get("turnoId")));
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Revisado." };
}

export async function limpiezaAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const kg = num(fd, "kg");
  if (kg == null || Number.isNaN(kg)) return { error: "Indicá cuántos kg usaste para limpiar." };
  const r = await registrarLimpieza(u, { cicloId: Number(fd.get("cicloId")), materiaPrimaId: Number(fd.get("materiaPrimaId")), kg, detalle: txt(fd, "detalle"), token: txt(fd, "token") });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: `Limpieza registrada: ${fmtPeso(kg)}.` };
}

export async function pedirMaterialAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  let items = null;
  try {
    items = JSON.parse(String(fd.get("ajustes") ?? "[]"));
  } catch {
    return { error: "No se pudieron leer las cantidades." };
  }
  const r = await pedirMaterial(u, { cicloId: Number(fd.get("cicloId")), items });
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: r.yaPedido ? "Ya está pedido: el Encargado lo tiene a la vista." : "Listo: le llegó al Encargado. Cuando dé el OK, Materia prima lo lleva." };
}

/** Encargado: OK al pedido del operario (le llega a Materia prima) o descartarlo. */
export async function avisarPedidoMaterialAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await avisarPedidoMaterial(u, Number(fd.get("novedadId")));
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Avisado: Materia prima lo ve para llevarlo." };
}

export async function descartarPedidoMaterialAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await descartarPedidoMaterial(u, Number(fd.get("novedadId")));
  if (r.error) return { error: r.error };
  revalidar();
  return { ok: "Pedido descartado." };
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
    descartePiezas: num(fd, "descartePiezas"),
    observaciones: txt(fd, "observaciones"),
  });
  if (r.error) return { error: r.error };
  revalidar();
  // Las etiquetas se imprimen al terminar la producción, no en cada turno (reunión 20/11/2026).
  return { ok: `Turno cerrado${r.piezas != null ? `: ${r.piezas} piezas en el turno` : ""}${r.cajas ? `, ${r.cajas} cajas a stock` : ""}.` };
}

export async function cerrarProduccionTallerAction(_p: EstadoAccion, fd: FormData): Promise<EstadoAccion> {
  const u = await getUsuarioActual();
  const r = await cerrarProduccionTaller(u, {
    cicloId: Number(fd.get("cicloId")),
    golpesFin: num(fd, "golpesFin"),
    descartePiezas: num(fd, "descartePiezas"),
    rebarbaKg: num(fd, "rebarbaKg"),
    scrapKg: num(fd, "scrapKg"),
    cerrarPartida: fd.get("cerrarPartida") === "on",
    sobrante: num(fd, "sobranteKg") && Number(fd.get("sobranteMpId")) ? { kg: num(fd, "sobranteKg")!, materiaPrimaDestinoId: Number(fd.get("sobranteMpId")) } : null,
  });
  if (r.error) return { error: r.error };
  revalidar();
  revalidatePath("/catalogo");
  revalidatePath("/etiquetas");
  // Las etiquetas aparecen al terminar la producción (reunión 20/11/2026): si
  // hay cajas, se pasa directo a imprimirlas. Los accesorios no llevan caja.
  if (r.cajas) redirect(`/taller/etiquetas?ciclo=${Number(fd.get("cicloId"))}&fin=1`);
  return { ok: `Producción cerrada: ${r.piezasAStock} piezas entraron a stock.` };
}
