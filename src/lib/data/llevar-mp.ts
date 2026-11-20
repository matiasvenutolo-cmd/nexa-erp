/**
 * «Para llevar a pie de máquina» (reunión 20/11/2026): lo que el Encargado ya
 * mandó a la secuencia le aparece a Materia prima como una lista de lo que hay
 * que llevar a cada máquina, con las bolsas que alcanzan para toda la tanda.
 * Dylan lo baja de la estantería y Daniela registra que se llevó; el
 * Encargado no tiene que hacer el retiro.
 *
 * Por cada tanda en cola con máquina (de hoy, de mañana o sin día):
 *   necesario = material de la tanda (receta × cargas, con la reforzada si
 *               corresponde), redondeado a bolsas enteras;
 *   llevado   = lo que ya está a pie de máquina para ese producto en esa
 *               máquina, más lo que quedó de la producción anterior y es de la
 *               receta (se reparte en el orden de la cola);
 *   falta     = necesario − llevado, en bolsas enteras.
 */
import { hoyISO, sumarDias } from "@/lib/format";
import { compararCola, listarTandas, type TandaVista } from "@/lib/data/planificacion";
import { obtenerRetirosMaquina } from "@/lib/data/maquina";
import { aGramos, fmtPeso, fmtPresentacion } from "@/lib/presentaciones";
import { nombreCortoMp } from "@/lib/codigos-mp";

export type MaterialALlevar = {
  materiaPrimaId: number;
  nombre: string;
  esMaster: boolean;
  /** Presentación con la que se arma (la más grande de la receta para ese material). */
  presentacion: string;
  kgPresentacion: number;
  necesarioKg: number;
  llevadoKg: number;
  /** Bolsas que faltan llevar (enteras) y sus kg. */
  faltaBolsas: number;
  faltaKg: number;
  texto: string;
};

export type TandaALlevar = {
  tandaId: number;
  inyectora: string;
  fecha: string | null;
  turno: TandaVista["turno"];
  dia: "hoy" | "manana" | "sin_dia" | "atrasada";
  productoId: number;
  codigo: string;
  colorNombre: string | null;
  matriz: string;
  piezas: number;
  sinReceta: boolean;
  /** Sin receta o sin peso por pieza no se puede calcular (no se inventa). */
  materiales: MaterialALlevar[];
  completa: boolean;
};

export async function paraLlevarAPie(hoy = hoyISO()): Promise<TandaALlevar[]> {
  const manana = sumarDias(hoy, 1);
  const tandas = (await listarTandas({ hoy }))
    .filter((t) => t.estado === "PLANIFICADA" && t.inyectora && (!t.fecha || t.fecha <= manana))
    .sort(compararCola);
  if (tandas.length === 0) return [];
  const retiros = await obtenerRetirosMaquina({ estado: "ABIERTO" });

  // Material ya a pie de máquina, por máquina: el llevado para un producto y lo
  // que quedó de una producción anterior.
  const pool = new Map<string, number>();
  const clave = (iny: string, origen: string, mp: number) => `${iny}|${origen}|${mp}`;
  for (const r of retiros)
    for (const l of r.lineas) {
      if (l.anulado || l.saldo.pie <= 1e-6) continue;
      const origen = r.cicloId == null && r.productoPrevistoId != null ? `p${r.productoPrevistoId}` : r.cicloId != null && !r.cicloAbierto ? "resto" : null;
      if (!origen) continue;
      const k = clave(r.inyectora, origen, l.materiaPrimaId);
      pool.set(k, (aGramos(pool.get(k) ?? 0) + aGramos(l.saldo.pie)) / 1000);
    }
  const tomar = (k: string, kg: number) => {
    const hay = pool.get(k) ?? 0;
    const t = Math.min(hay, kg);
    pool.set(k, (aGramos(hay) - aGramos(t)) / 1000);
    return t;
  };

  return tandas.map((t) => {
    const items = [...(t.receta?.items ?? []), ...(t.usarArranque ? (t.recetaArranque?.items ?? []) : [])];
    const materiales: MaterialALlevar[] = t.material.map((m) => {
      const pres = items.filter((i) => i.materiaPrimaId === m.materiaPrimaId).sort((a, b) => b.kgPresentacion - a.kgPresentacion)[0];
      const kgPres = pres?.kgPresentacion ?? 0;
      const necesario = kgPres > 0 ? (Math.ceil(aGramos(m.requeridoKg) / aGramos(kgPres) - 1e-9) * aGramos(kgPres)) / 1000 : m.requeridoKg;
      let llevado = tomar(clave(t.inyectora!, `p${t.productoId}`, m.materiaPrimaId), necesario);
      llevado = (aGramos(llevado) + aGramos(tomar(clave(t.inyectora!, "resto", m.materiaPrimaId), (aGramos(necesario) - aGramos(llevado)) / 1000))) / 1000;
      const faltaKg0 = Math.max(0, (aGramos(necesario) - aGramos(llevado)) / 1000);
      const faltaBolsas = kgPres > 0 ? Math.ceil(aGramos(faltaKg0) / aGramos(kgPres) - 1e-9) : 0;
      const faltaKg = kgPres > 0 ? (faltaBolsas * aGramos(kgPres)) / 1000 : faltaKg0;
      return {
        materiaPrimaId: m.materiaPrimaId,
        nombre: nombreCortoMp(m.nombre),
        esMaster: m.esMaster,
        presentacion: pres?.presentacionNombre ?? "",
        kgPresentacion: kgPres,
        necesarioKg: necesario,
        llevadoKg: llevado,
        faltaBolsas,
        faltaKg,
        texto: faltaKg <= 1e-6 ? "ya está" : kgPres > 0 && pres ? fmtPresentacion(faltaBolsas, pres.presentacionNombre) : fmtPeso(faltaKg),
      };
    });
    const dia = !t.fecha ? "sin_dia" : t.fecha < hoy ? "atrasada" : t.fecha === hoy ? "hoy" : "manana";
    return {
      tandaId: t.id,
      inyectora: t.inyectora!,
      fecha: t.fecha,
      turno: t.turno,
      dia,
      productoId: t.productoId,
      codigo: t.codigo,
      colorNombre: t.colorNombre,
      matriz: t.matriz,
      piezas: t.objetivo,
      sinReceta: !t.receta,
      materiales,
      completa: materiales.length > 0 && materiales.every((m) => m.faltaKg <= 1e-6),
    };
  });
}
