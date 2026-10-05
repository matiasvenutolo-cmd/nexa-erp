/**
 * Parámetros globales (tabla `parametro`). Los valores iniciales los carga la
 * migración 0003 — acá no hay ningún valor por defecto: si falta una fila,
 * el sistema lo dice en vez de inventar un número.
 */
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { parametro } from "@/lib/db/schema";
import { puedeEditarParametrosProduccion } from "@/lib/auth/permisos";
import { registrarCambios, ultimasModificaciones, type Actor, type Resultado } from "@/lib/data/auditoria";

export const PARAMETROS = {
  SEMAFORO_MARGEN_BAJO: "semaforo_margen_bajo",
  UNIDADES_POR_CAJA_PISOS: "unidades_por_caja_pisos",
} as const;

export type ClaveParametro = (typeof PARAMETROS)[keyof typeof PARAMETROS];
export type Parametros = Record<ClaveParametro, number>;

const ETIQUETA: Record<ClaveParametro, string> = {
  semaforo_margen_bajo: "Margen del semáforo para \"Bajo\"",
  unidades_por_caja_pisos: "Unidades por caja de pisos",
};

export async function obtenerParametros(): Promise<Parametros> {
  const filas = await db.select({ clave: parametro.clave, valor: parametro.valor }).from(parametro);
  const valores = new Map(filas.map((f) => [f.clave, Number(f.valor)]));
  const resultado = {} as Parametros;
  for (const clave of Object.values(PARAMETROS)) {
    const v = valores.get(clave);
    if (v == null || !Number.isFinite(v)) {
      throw new Error(`Falta el parámetro "${clave}" en la base — correr las migraciones (npm run db:migrate).`);
    }
    resultado[clave] = v;
  }
  return resultado;
}

export type FilaParametro = typeof parametro.$inferSelect & {
  etiqueta: string;
  ultimaModificacion: { fecha: Date; usuarioNombre: string } | null;
};

export async function listarParametros(): Promise<FilaParametro[]> {
  const filas = await db.select().from(parametro).orderBy(asc(parametro.clave));
  const ultimas = await ultimasModificaciones("parametro", filas.map((f) => f.clave));
  return filas.map((f) => ({
    ...f,
    etiqueta: ETIQUETA[f.clave as ClaveParametro] ?? f.clave,
    ultimaModificacion: ultimas.get(f.clave) ?? null,
  }));
}

function validar(clave: ClaveParametro, valor: number): string | null {
  if (!Number.isFinite(valor) || valor < 0) return "El valor tiene que ser un número mayor o igual a cero.";
  if (clave === PARAMETROS.UNIDADES_POR_CAJA_PISOS && (!Number.isInteger(valor) || valor === 0)) {
    return "Las unidades por caja tienen que ser un número entero mayor que cero.";
  }
  return null;
}

export async function actualizarParametro(
  actor: Actor,
  clave: string,
  valor: number,
  motivo?: string | null,
): Promise<Resultado> {
  if (!puedeEditarParametrosProduccion(actor.rol)) return { error: "No tenés permiso para cambiar parámetros." };
  if (!(Object.values(PARAMETROS) as string[]).includes(clave)) return { error: "Parámetro desconocido." };
  const error = validar(clave as ClaveParametro, valor);
  if (error) return { error };

  return db.transaction(async (tx) => {
    const [actual] = await tx.select().from(parametro).where(eq(parametro.clave, clave));
    if (!actual) return { error: "El parámetro no existe en la base." };
    await tx
      .update(parametro)
      .set({ valor: String(valor), actualizadoEn: new Date(), actualizadoPorId: actor.id })
      .where(eq(parametro.clave, clave));
    await registrarCambios(tx, actor.id, [
      { entidad: "parametro", entidadId: clave, campo: "valor", anterior: actual.valor, nuevo: valor, motivo },
    ]);
    return {};
  });
}
