/**
 * Turno según la hora (listado de mejoras: «no debería tener que seleccionar
 * el turno, debería ya estar puesto según la hora del día»). Los horarios de
 * inicio son parámetros (Administración → Parámetros); mientras alguno no esté
 * configurado (−1) no se adivina: devuelve null y la pantalla pide elegirlo.
 *
 * El turno que cruza la medianoche pertenece al día en que empezó: a las 3:00
 * del martes se está en el turno noche del lunes.
 */
export type Turno = "MANANA" | "TARDE" | "NOCHE";
export type HorariosTurno = Record<Turno, number | null>;

export function horariosDesdeParametros(p: { turno_manana_inicio: number; turno_tarde_inicio: number; turno_noche_inicio: number }): HorariosTurno {
  const h = (v: number) => (Number.isInteger(v) && v >= 0 && v <= 23 ? v : null);
  return { MANANA: h(p.turno_manana_inicio), TARDE: h(p.turno_tarde_inicio), NOCHE: h(p.turno_noche_inicio) };
}

/** Hora y fecha en Buenos Aires. */
function partesAR(d: Date): { fecha: string; hora: number } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => f.find((x) => x.type === t)?.value ?? "";
  return { fecha: `${v("year")}-${v("month")}-${v("day")}`, hora: Number(v("hour")) };
}

function diaAnterior(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function turnoDe(ahora: Date, horarios: HorariosTurno): { turno: Turno; fecha: string } | null {
  if (horarios.MANANA == null || horarios.TARDE == null || horarios.NOCHE == null) return null;
  const { fecha, hora } = partesAR(ahora);
  const inicios = (Object.entries(horarios) as [Turno, number][]).sort((a, b) => a[1] - b[1]);
  // El último turno que empezó a esta hora o antes; si ninguno, el último del día anterior.
  const hoy = [...inicios].reverse().find(([, h]) => h <= hora);
  if (hoy) return { turno: hoy[0], fecha };
  return { turno: inicios[inicios.length - 1][0], fecha: diaAnterior(fecha) };
}
