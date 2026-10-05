/**
 * Historial de cambios de configuración (tabla `auditoria_config`). Todo
 * cambio de mínimo, máximo, master, color, parámetro, usuario o prioridad se
 * registra acá en la MISMA transacción que el cambio — si el cambio se
 * guarda, queda su rastro; si falla, no queda un rastro falso.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { auditoriaConfig, cliente, color, dosificacionMaster, materiaPrima, pedido, producto, usuario } from "@/lib/db/schema";

export type Rol = (typeof usuario.$inferSelect)["rol"];
export type Actor = { id: number; rol: Rol };
export type Resultado = { error?: string };

type Ejecutor = Pick<typeof db, "insert" | "select">;

export type Cambio = {
  entidad: string;
  entidadId: string | number;
  campo: string;
  anterior: unknown;
  nuevo: unknown;
  motivo?: string | null;
};

function aTexto(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Inserta sólo los campos que efectivamente cambiaron. */
export async function registrarCambios(ex: Ejecutor, usuarioId: number, cambios: Cambio[]): Promise<number> {
  const filas = cambios
    .map((c) => ({ ...c, anteriorTxt: aTexto(c.anterior), nuevoTxt: aTexto(c.nuevo) }))
    .filter((c) => !mismoValor(c.anteriorTxt, c.nuevoTxt))
    .map((c) => ({
      entidad: c.entidad,
      entidadId: String(c.entidadId),
      campo: c.campo,
      valorAnterior: c.anteriorTxt,
      valorNuevo: c.nuevoTxt,
      motivo: c.motivo?.trim() || null,
      usuarioId,
    }));
  if (filas.length > 0) await ex.insert(auditoriaConfig).values(filas);
  return filas.length;
}

/** "500" y "500.000" (numeric de Postgres) son el mismo valor. */
function mismoValor(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

export type UltimaModificacion = { fecha: Date; usuarioNombre: string };

/** Última modificación por entidad — la columna "Última modificación" del Panel Admin. */
export async function ultimasModificaciones(
  entidad: string,
  ids: (string | number)[],
): Promise<Map<string, UltimaModificacion>> {
  if (ids.length === 0) return new Map();
  const filas = await db
    .selectDistinctOn([auditoriaConfig.entidadId], {
      entidadId: auditoriaConfig.entidadId,
      fecha: auditoriaConfig.creadoEn,
      usuarioNombre: usuario.nombre,
    })
    .from(auditoriaConfig)
    .innerJoin(usuario, eq(auditoriaConfig.usuarioId, usuario.id))
    .where(and(eq(auditoriaConfig.entidad, entidad), inArray(auditoriaConfig.entidadId, ids.map(String))))
    .orderBy(auditoriaConfig.entidadId, desc(auditoriaConfig.creadoEn), desc(auditoriaConfig.id));
  return new Map(filas.map((f) => [f.entidadId, { fecha: f.fecha, usuarioNombre: f.usuarioNombre }]));
}

export type FilaAuditoria = typeof auditoriaConfig.$inferSelect & { usuarioNombre: string };

export async function listarAuditoria(filtro?: {
  entidad?: string;
  entidadId?: string | number;
  limite?: number;
}): Promise<FilaAuditoria[]> {
  const condiciones = [];
  if (filtro?.entidad) condiciones.push(eq(auditoriaConfig.entidad, filtro.entidad));
  if (filtro?.entidadId != null) condiciones.push(eq(auditoriaConfig.entidadId, String(filtro.entidadId)));
  const filas = await db
    .select({ a: auditoriaConfig, usuarioNombre: usuario.nombre })
    .from(auditoriaConfig)
    .innerJoin(usuario, eq(auditoriaConfig.usuarioId, usuario.id))
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(desc(auditoriaConfig.creadoEn), desc(auditoriaConfig.id))
    .limit(filtro?.limite ?? 300);
  return filas.map((f) => ({ ...f.a, usuarioNombre: f.usuarioNombre }));
}

const ENTIDAD_LABEL: Record<string, string> = {
  producto: "Producto",
  materia_prima: "Materia prima",
  color: "Color",
  dosificacion_master: "Master",
  parametro: "Parámetro",
  usuario: "Usuario",
  pedido: "Pedido",
};

/** Nombre legible de cada fila del historial ("Producto 001B-PR-NE"). */
export async function etiquetarAuditoria(filas: FilaAuditoria[]): Promise<Map<number, string>> {
  const ids = (entidad: string) =>
    [...new Set(filas.filter((f) => f.entidad === entidad).map((f) => Number(f.entidadId)))].filter(Number.isFinite);

  const [productos, materias, colores, dosificaciones, usuarios, pedidos] = await Promise.all([
    ids("producto").length
      ? db.select({ id: producto.id, n: producto.codigo }).from(producto).where(inArray(producto.id, ids("producto")))
      : [],
    ids("materia_prima").length
      ? db.select({ id: materiaPrima.id, n: materiaPrima.nombre }).from(materiaPrima).where(inArray(materiaPrima.id, ids("materia_prima")))
      : [],
    ids("color").length ? db.select({ id: color.id, n: color.nombre }).from(color).where(inArray(color.id, ids("color"))) : [],
    ids("dosificacion_master").length
      ? db
          .select({ id: dosificacionMaster.id, familia: dosificacionMaster.familia, colorNombre: color.nombre })
          .from(dosificacionMaster)
          .leftJoin(color, eq(dosificacionMaster.colorId, color.id))
          .where(inArray(dosificacionMaster.id, ids("dosificacion_master")))
      : [],
    ids("usuario").length ? db.select({ id: usuario.id, n: usuario.nombre }).from(usuario).where(inArray(usuario.id, ids("usuario"))) : [],
    ids("pedido").length
      ? db
          .select({ id: pedido.id, n: cliente.nombre })
          .from(pedido)
          .innerJoin(cliente, eq(pedido.clienteId, cliente.id))
          .where(inArray(pedido.id, ids("pedido")))
      : [],
  ]);

  const nombres = new Map<string, string>();
  for (const p of productos) nombres.set(`producto:${p.id}`, p.n);
  for (const m of materias) nombres.set(`materia_prima:${m.id}`, m.n);
  for (const c of colores) nombres.set(`color:${c.id}`, c.n);
  for (const d of dosificaciones) nombres.set(`dosificacion_master:${d.id}`, `${d.familia === "REJILLA" ? "Rejilla" : "Ciego"} · ${d.colorNombre ?? "todos los colores"}`);
  for (const u of usuarios) nombres.set(`usuario:${u.id}`, u.n);
  for (const p of pedidos) nombres.set(`pedido:${p.id}`, `#${p.id} ${p.n}`);

  return new Map(
    filas.map((f) => [
      f.id,
      `${ENTIDAD_LABEL[f.entidad] ?? f.entidad} ${nombres.get(`${f.entidad}:${f.entidadId}`) ?? f.entidadId}`,
    ]),
  );
}
