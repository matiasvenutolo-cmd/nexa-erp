import type { EstadoSemaforo } from "@/lib/data/stock";

const LABEL: Record<EstadoSemaforo, string> = {
  critico: "Crítico",
  bajo: "Bajo",
  ok: "OK",
  exceso: "Exceso",
  "sin-datos": "Sin datos",
};

const CLASE: Record<EstadoSemaforo, string> = {
  critico: "badge-estado badge-critico",
  bajo: "badge-estado badge-bajo",
  ok: "badge-estado badge-ok",
  exceso: "badge-estado badge-exceso",
  "sin-datos": "badge-estado bg-surface-muted text-foreground-muted",
};

export function Semaforo({ estado }: { estado: EstadoSemaforo }) {
  return <span className={CLASE[estado]}>{LABEL[estado]}</span>;
}
