/**
 * Página de arranque.
 *
 * El sistema se entrega en 6 releases (ver README y docs/03-plan-release-1.md). El estado
 * de cada uno se actualiza a mano acá; "falta" lista lo que todavía no está hecho.
 * Es pública (src/proxy.ts la deja pasar sin sesión) porque es la URL que ve
 * el cliente sin necesidad de cuenta — pero por eso mismo tiene que dejar
 * clarísimo cómo se entra al sistema de verdad: nada de que alguien llegue
 * acá y no encuentre el link a /login (bug real, detectado por Matías el
 * 25/09 al abrir el link recién entregado).
 */
import Link from "next/link";

type EstadoRelease = "Completado" | "En curso" | "Pendiente";

const RELEASES: { id: string; titulo: string; detalle: string; estado: EstadoRelease; falta?: string }[] = [
  {
    id: "R1",
    titulo: "Núcleo + Pedidos",
    detalle:
      "Usuarios y accesos reales, catálogo de productos, clientes, carga de pedidos con chequeo de stock y reserva de material.",
    estado: "Completado",
  },
  {
    id: "R2",
    titulo: "Stock",
    detalle:
      "Entradas, salidas y correcciones con historial. Stock disponible, comprometido y a producir. Mínimos, máximos y semáforo configurables.",
    estado: "Completado",
    falta: "Pantalla propia de recuento físico semanal (hoy se registra como corrección de stock con motivo).",
  },
  {
    id: "R3",
    titulo: "Producción",
    detalle:
      "Cola de producción priorizada, carga del ciclo de inyección en dos pasos, partidas generadas por el sistema y cajas por partida.",
    estado: "Completado",
    falta: "Impresión de la etiqueta de cada caja (ver R5).",
  },
  {
    id: "R4",
    titulo: "Materia prima y trazabilidad",
    detalle:
      "Lotes y certificados de calidad, retiro a máquina vinculado a la producción, dosificación de master y trazabilidad completa del certificado al cliente.",
    estado: "Completado",
    falta: "Recetas por producto (proporción de cada materia prima).",
  },
  {
    id: "R5",
    titulo: "Etiquetas y despacho",
    detalle:
      "Despacho parcial, doble control, aviso a ventas, remitos interno y legal, y reclamos con informe a gerencia.",
    estado: "En curso",
    falta: "Etiquetas de producto y de cliente.",
  },
  {
    id: "R6",
    titulo: "Planificación",
    detalle:
      "Necesidad semanal de compra de materia prima, compras en proceso e indicadores de gerencia.",
    estado: "Pendiente",
  },
];

const ESTILO_ESTADO: Record<EstadoRelease, string> = {
  Completado: "bg-[var(--estado-ok-bg)] text-[var(--estado-ok-fg)]",
  "En curso": "bg-accent-soft text-accent",
  Pendiente: "bg-surface-muted text-foreground-muted",
};

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="border-b border-border pb-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-foreground-muted">
              Conexiones Plásticas Sudamericana
            </p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight text-brand-azul-oscuro">
              NEXA · Producción y stock
            </h1>
          </div>
          <Link
            href="/login"
            className="shrink-0 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
          >
            Entrar al sistema →
          </Link>
        </div>
        <p className="mt-4 text-base leading-relaxed text-foreground-muted">
          Reemplaza el circuito de planillas por una única aplicación que cubre el
          recorrido completo del pedido: venta, stock, producción, partidas, materia
          prima, despacho y trazabilidad.
        </p>
      </header>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
          Entregas
        </h2>
        <ol className="mt-5 space-y-3">
          {RELEASES.map((r) => {
            return (
              <li
                key={r.id}
                className="rounded-lg border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(18,19,44,0.04)]"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h3 className="font-semibold text-foreground">
                    <span className="font-mono text-accent">{r.id}</span>
                    <span className="mx-2 text-border">·</span>
                    {r.titulo}
                  </h3>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${ESTILO_ESTADO[r.estado]}`}>
                    {r.estado}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
                  {r.detalle}
                </p>
                {r.falta && <p className="mt-1 text-sm text-foreground">Pendiente: {r.falta}</p>}
              </li>
            );
          })}
        </ol>
      </section>
    </main>
  );
}
