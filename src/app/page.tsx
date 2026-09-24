/**
 * Página de arranque.
 *
 * El sistema se entrega en 6 releases mensuales (ver README y docs/03-plan-release-1.md).
 * Hasta que R1 tenga sus pantallas, esta página deja visible el estado del
 * proyecto: es la URL que ve el cliente, así que no puede estar vacía.
 */

const RELEASES = [
  {
    id: "R1",
    titulo: "Núcleo + Pedidos",
    detalle:
      "Usuarios y accesos reales, catálogo de productos, clientes, carga de pedidos con chequeo de stock y reserva de material.",
    estado: "En curso",
  },
  {
    id: "R2",
    titulo: "Stock",
    detalle:
      "Entradas, salidas y correcciones con historial. Stock disponible, comprometido y a producir. Recuento físico semanal.",
    estado: "Pendiente",
  },
  {
    id: "R3",
    titulo: "Producción",
    detalle:
      "Cola de producción priorizada, carga del ciclo de inyección en dos pasos, partidas generadas por el sistema y cajas etiquetadas.",
    estado: "Pendiente",
  },
  {
    id: "R4",
    titulo: "Materia prima y trazabilidad",
    detalle:
      "Recetas por producto, lotes y certificados de calidad, retiro a tolva y consumo real de material.",
    estado: "Pendiente",
  },
  {
    id: "R5",
    titulo: "Etiquetas y despacho",
    detalle:
      "Etiqueta de producto y de cliente, despacho parcial, doble piqueo, remitos y devoluciones.",
    estado: "Pendiente",
  },
  {
    id: "R6",
    titulo: "Planificación",
    detalle:
      "Necesidad semanal de compra de materia prima, compras en proceso e indicadores de gerencia.",
    estado: "Pendiente",
  },
];

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="border-b border-border pb-8">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-foreground-muted">
          Conexiones Plásticas Sudamericana
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-brand-azul-oscuro">
          NEXA · Producción y stock
        </h1>
        <p className="mt-4 text-base leading-relaxed text-foreground-muted">
          Sistema en construcción. Reemplaza el circuito actual de planillas por una
          única aplicación que cubre el recorrido completo del pedido: venta, stock,
          producción, partidas, etiquetas y despacho.
        </p>
      </header>

      <section className="mt-10">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground-muted">
          Entregas
        </h2>
        <ol className="mt-5 space-y-3">
          {RELEASES.map((r) => {
            const enCurso = r.estado === "En curso";
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
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      enCurso
                        ? "bg-accent-soft text-accent"
                        : "bg-surface-muted text-foreground-muted"
                    }`}
                  >
                    {r.estado}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground-muted">
                  {r.detalle}
                </p>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="mt-12 border-t border-border pt-6 text-sm text-foreground-muted">
        Desarrollado por Pinaro.
      </footer>
    </main>
  );
}
