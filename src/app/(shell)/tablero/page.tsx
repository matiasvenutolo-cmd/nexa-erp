import Link from "next/link";
import { obtenerTablero } from "@/lib/data/tablero";
import { getUsuarioActual } from "@/lib/session";
import { puedeCrearPedido } from "@/lib/auth/permisos";
import { ESTADO_LABEL } from "@/lib/data/pedidos";
import { Semaforo } from "@/components/semaforo";
import { fmtNumero } from "@/lib/format";
import type { EstadoSemaforo } from "@/lib/data/stock";

const ESTADOS_PEDIDO = ["PEDIDO", "EN_ARMADO", "LISTO_PARA_DESPACHAR", "ENTREGADO"] as const;
const ESTADOS_SEMAFORO: EstadoSemaforo[] = ["critico", "bajo", "ok", "exceso"];

export default async function TableroPage() {
  const usuario = await getUsuarioActual();
  const gestion = puedeCrearPedido(usuario.rol);
  const t = await obtenerTablero();

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-brand-azul-oscuro">Tablero</h1>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
          Pedidos
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ESTADOS_PEDIDO.map((e) => (
            <Link
              key={e}
              href={`/pedidos?estado=${e}`}
              className="rounded-lg border border-border bg-surface p-4 hover:bg-surface-muted"
            >
              <div className="text-2xl font-semibold text-foreground">{t.pedidosPorEstado[e]}</div>
              <div className="text-sm text-foreground-muted">{ESTADO_LABEL[e]}</div>
            </Link>
          ))}
        </div>
      </section>

      {gestion && (
        <>
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-foreground-muted">
              Estado del catálogo
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {ESTADOS_SEMAFORO.map((e) => (
                <Link
                  key={e}
                  href={e === "critico" || e === "bajo" ? "/catalogo?alertas=1" : "/catalogo"}
                  className="rounded-lg border border-border bg-surface p-4 hover:bg-surface-muted"
                >
                  <div className="text-2xl font-semibold text-foreground">{t.alertasPorEstado[e]}</div>
                  <Semaforo estado={e} />
                </Link>
              ))}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel titulo="Productos bajo mínimo" verMas="/catalogo?alertas=1">
              {t.productosEnAlerta.length === 0 ? (
                <p className="text-sm text-foreground-muted">Nada en alerta.</p>
              ) : (
                <FilaLista
                  items={t.productosEnAlerta.map((p) => ({
                    key: p.id,
                    izquierda: `${p.codigo} · ${p.descripcion}`,
                    derecha: `${fmtNumero(p.stock, 0)} / mín ${fmtNumero(p.minimo, 0)}`,
                  }))}
                />
              )}
            </Panel>

            <Panel titulo="Falta producir para cubrir pedidos" verMas="/pedidos">
              {t.comprometidoTop.length === 0 ? (
                <p className="text-sm text-foreground-muted">No hay faltantes hoy.</p>
              ) : (
                <FilaLista
                  items={t.comprometidoTop.map((c) => ({
                    key: c.productoId,
                    izquierda: `${c.codigo} · ${c.descripcion}`,
                    derecha: `${fmtNumero(c.faltaProducir, 0)} u.`,
                    resaltado: true,
                  }))}
                />
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:w-64">
            <StatChica label="Productos" valor={t.totalProductos} />
            <StatChica label="Clientes" valor={t.totalClientes} />
          </div>
        </>
      )}
    </div>
  );
}

function Panel({ titulo, verMas, children }: { titulo: string; verMas: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
        <Link href={verMas} className="text-xs font-medium text-accent hover:underline">
          Ver más →
        </Link>
      </div>
      {children}
    </div>
  );
}

function FilaLista({
  items,
}: {
  items: { key: number; izquierda: string; derecha: string; resaltado?: boolean }[];
}) {
  return (
    <ul className="space-y-2 text-sm">
      {items.map((it) => (
        <li key={it.key} className="flex items-baseline justify-between gap-3">
          <span className="truncate text-foreground-muted">{it.izquierda}</span>
          <span className={it.resaltado ? "shrink-0 font-medium text-[var(--estado-critico-fg)]" : "shrink-0 text-foreground"}>
            {it.derecha}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StatChica({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="text-lg font-semibold text-foreground">{fmtNumero(valor, 0)}</div>
      <div className="text-xs text-foreground-muted">{label}</div>
    </div>
  );
}
