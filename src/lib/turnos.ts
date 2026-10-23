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

// ---------------------------------------------------------------------------
// Esquemas de turno (mejoras 22/10). Reemplazan a los horarios por parámetro:
// el Encargado elige el esquema de cada día y la hora sola no siempre alcanza
// (de 12 a 16 hay dos turnos activos en el esquema doble).
// ---------------------------------------------------------------------------

export type Esquema = "SIMPLE" | "DOBLE" | "TRIPLE";

/** Ventanas [desde, hasta) en minutos desde las 0:00. La noche termina al día
 *  siguiente (hasta > 1440). */
export const VENTANAS: Record<Esquema, { turno: Turno; desde: number; hasta: number }[]> = {
  SIMPLE: [{ turno: "MANANA", desde: 7 * 60, hasta: 16 * 60 }],
  DOBLE: [
    { turno: "MANANA", desde: 7 * 60, hasta: 16 * 60 },
    { turno: "TARDE", desde: 12 * 60, hasta: 21 * 60 },
  ],
  TRIPLE: [
    { turno: "MANANA", desde: 7 * 60, hasta: 16 * 60 },
    { turno: "TARDE", desde: 13 * 60, hasta: 22 * 60 },
    { turno: "NOCHE", desde: 22 * 60, hasta: 31 * 60 },
  ],
};

export const ESQUEMA_LABEL: Record<Esquema, string> = {
  SIMPLE: "Simple (7 a 16)",
  DOBLE: "Doble (7 a 16 y 12 a 21)",
  TRIPLE: "Triple (7 a 16, 13 a 22 y 22 a 7)",
};

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function horarioDe(esquema: Esquema, turno: Turno): string | null {
  const v = VENTANAS[esquema].find((x) => x.turno === turno);
  return v ? `${hhmm(v.desde)} a ${hhmm(v.hasta)}` : null;
}

function minutosAR(d: Date): { fecha: string; minutos: number } {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d);
  const v = (t: string) => f.find((x) => x.type === t)?.value ?? "";
  return { fecha: `${v("year")}-${v("month")}-${v("day")}`, minutos: Number(v("hour")) * 60 + Number(v("minute")) };
}

export type TurnoPosible = { turno: Turno; fecha: string; esquema: Esquema };

/**
 * Turnos activos en este momento según el esquema de cada día. El turno noche
 * pertenece al día en que empezó: a las 3:00 del martes es la noche del lunes
 * (si el lunes tenía esquema triple). Devuelve 0, 1 o 2 turnos: con uno solo
 * no hace falta preguntar; con dos (superposición) el operario elige.
 */
export function turnosPosibles(ahora: Date, esquemaDe: (fecha: string) => Esquema | null): TurnoPosible[] {
  const { fecha, minutos } = minutosAR(ahora);
  const res: TurnoPosible[] = [];
  const ayer = diaAnterior(fecha);
  const esqAyer = esquemaDe(ayer);
  if (esqAyer) {
    for (const v of VENTANAS[esqAyer]) if (v.hasta > 1440 && minutos + 1440 >= v.desde && minutos + 1440 < v.hasta) res.push({ turno: v.turno, fecha: ayer, esquema: esqAyer });
  }
  const esqHoy = esquemaDe(fecha);
  if (esqHoy) {
    for (const v of VENTANAS[esqHoy]) if (minutos >= v.desde && minutos < v.hasta) res.push({ turno: v.turno, fecha, esquema: esqHoy });
  }
  return res;
}

/** Fecha del día en Buenos Aires (y la del día anterior, para la noche). */
export function fechasParaTurno(ahora: Date): { hoy: string; ayer: string } {
  const { fecha } = minutosAR(ahora);
  return { hoy: fecha, ayer: diaAnterior(fecha) };
}
