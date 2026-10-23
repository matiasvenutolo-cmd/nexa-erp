export function fmtFecha(d: Date | string): string {
  return new Date(d).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

const ZONA = "America/Argentina/Buenos_Aires";

/** Día de un momento real (timestamp: creación, entrega, movimiento) en hora
 *  argentina. `fmtFecha` es para fechas sin hora (columnas `date`). */
export function fmtDia(d: Date | string): string {
  return new Date(d).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: ZONA });
}

/** "Hoy" en Argentina como AAAA-MM-DD. Con UTC, después de las 21 h lo cargado
 *  quedaba con la fecha del día siguiente. */
export function hoyISO(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: ZONA }).format(new Date());
}

export function fmtMoneda(v: string | number | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);
}

export function fmtNumero(v: string | number | null | undefined, maxDecimals = 2): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: maxDecimals }).format(n);
}

export function fmtFechaHora(d: Date | string): string {
  return new Date(d).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "America/Argentina/Buenos_Aires",
  });
}

/** "14:05", hora argentina, 24 h. */
export function fmtHora(d: Date | string): string {
  return new Date(d).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Argentina/Buenos_Aires" });
}

/** Suma días a una fecha ISO (AAAA-MM-DD). */
export function sumarDias(f: string, n: number): string {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de una fecha ISO. */
export function lunesDe(f: string): string {
  const d = new Date(`${f}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return sumarDias(f, -dow);
}
