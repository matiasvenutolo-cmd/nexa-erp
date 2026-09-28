import Link from "next/link";
import { listarMovimientosProducto, signoCantidad } from "@/lib/data/stock";
import { listarProductos } from "@/lib/data/catalogo";
import { CorreccionStock } from "./correccion-stock";
import { fmtFecha, fmtNumero } from "@/lib/format";

const TIPOS = ["ENTRADA", "SALIDA", "AJUSTE"] as const;
const TIPO_LABEL: Record<string, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  AJUSTE: "Ajuste manual",
};

export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string; productoId?: string }>;
}) {
  const sp = await searchParams;
  const tipo = (TIPOS as readonly string[]).includes(sp.tipo ?? "")
    ? (sp.tipo as (typeof TIPOS)[number])
    : undefined;
  const productoId = sp.productoId ? Number(sp.productoId) : undefined;

  const [movimientos, productos] = await Promise.all([
    listarMovimientosProducto({ tipo, productoId }),
    listarProductos(),
  ]);

  const query = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { tipo: sp.tipo, productoId: sp.productoId, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/catalogo/movimientos?${qs}` : "/catalogo/movimientos";
  };

  return (
    <div className="space-y-5">
      <div>
        <Link href="/catalogo" className="text-sm text-foreground-muted hover:text-foreground">
          ← Catálogo
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Movimientos de stock</h1>
      </div>

      <CorreccionStock productos={productos} />

      <div className="flex flex-wrap items-center gap-2">
        <FiltroTab href={query({ tipo: undefined })} activo={!tipo} label="Todos" />
        {TIPOS.map((t) => (
          <FiltroTab key={t} href={query({ tipo: t })} activo={tipo === t} label={TIPO_LABEL[t]} />
        ))}
      </div>

      <form action="/catalogo/movimientos" className="flex flex-wrap items-center gap-2">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        <select name="productoId" defaultValue={productoId ?? ""} className="input w-auto max-w-[280px]">
          <option value="">Todos los productos</option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} · {p.descripcion}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-md bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground-muted hover:text-foreground">
          Filtrar
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                <th className="px-4 py-2.5">Fecha</th>
                <th className="px-4 py-2.5">Producto</th>
                <th className="px-4 py-2.5">Tipo</th>
                <th className="px-4 py-2.5 text-right">Cantidad</th>
                <th className="px-4 py-2.5">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {movimientos.map((m) => {
                const signo = signoCantidad(m.tipo, m.cantidad);
                return (
                  <tr key={m.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-foreground-muted">{fmtFecha(m.fecha)}</td>
                    <td className="px-4 py-3">
                      {m.productoCodigo ? (
                        <>
                          <span className="font-mono text-xs text-foreground-muted">{m.productoCodigo}</span>{" "}
                          <span className="text-foreground">{m.productoDescripcion}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">{TIPO_LABEL[m.tipo] ?? m.tipo}</td>
                    <td
                      className={`px-4 py-3 text-right font-medium ${
                        signo < 0 ? "text-[var(--estado-critico-fg)]" : "text-[var(--estado-ok-fg)]"
                      }`}
                    >
                      {signo > 0 ? "+" : ""}
                      {fmtNumero(signo, 0)}
                    </td>
                    <td className="px-4 py-3 text-foreground-muted">{m.motivo ?? "—"}</td>
                  </tr>
                );
              })}
              {movimientos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-foreground-muted">
                    No hay movimientos que coincidan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FiltroTab({ href, activo, label }: { href: string; activo: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${
        activo ? "bg-accent text-accent-foreground" : "bg-surface-muted text-foreground-muted hover:text-foreground"
      }`}
    >
      {label}
    </Link>
  );
}
