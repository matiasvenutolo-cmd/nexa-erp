export function fmtFecha(d: Date | string): string {
  return new Date(d).toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
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
