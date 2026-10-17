import Link from "next/link";
import { listarProductos, type FilaProducto } from "@/lib/data/catalogo";
import { getUsuarioActual } from "@/lib/session";
import { puedeVerMateriaPrima } from "@/lib/auth/permisos";
import { Semaforo } from "@/components/semaforo";
import { fmtNumero } from "@/lib/format";
import { etiquetaTipo } from "@/lib/etiquetas";
import { materialComprometido } from "@/lib/data/pedidos";

const CLASES = [
  { valor: undefined, label: "Todos" },
  { valor: "pisos" as const, label: "Pisos" },
  { valor: "accesorios" as const, label: "Accesorios" },
];
const FAMILIAS = [
  { valor: undefined, label: "Rejilla y Ciego" },
  { valor: "REJILLA" as const, label: "Rejilla" },
  { valor: "CIEGO" as const, label: "Ciego" },
];

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ familia?: string; clase?: string; texto?: string; alertas?: string }>;
}) {
  const sp = await searchParams;
  const usuario = await getUsuarioActual();
  const familia = sp.familia === "REJILLA" || sp.familia === "CIEGO" ? sp.familia : undefined;
  const clase = sp.clase === "pisos" || sp.clase === "accesorios" ? sp.clase : undefined;
  const soloAlertas = sp.alertas === "1";

  const [productos, comprometido] = await Promise.all([listarProductos({ familia, clase, texto: sp.texto }), materialComprometido()]);
  const visibles = soloAlertas ? productos.filter((p) => p.estado === "critico" || p.estado === "bajo") : productos;

  // Segmentos: Pisos Rejilla, Pisos Ciego, Accesorios Rejilla, Accesorios Ciego.
  const grupos = new Map<string, FilaProducto[]>();
  for (const p of visibles) {
    const clave = `${p.esAccesorio ? "Accesorios" : "Pisos"} · ${p.familia === "REJILLA" ? "Rejilla" : "Ciego"}`;
    grupos.set(clave, [...(grupos.get(clave) ?? []), p]);
  }

  const query = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { familia: sp.familia, clase: sp.clase, texto: sp.texto, alertas: sp.alertas, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/catalogo?${qs}` : "/catalogo";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="encabezado mb-0">
          <div>
            <h1>Stock de productos</h1>
            <p>Entrá a cada producto con «Ver existencias» para ver sus cajas, completas y abiertas.</p>
          </div>
        </div>
        <div className="flex gap-4 text-sm">
          {puedeVerMateriaPrima(usuario.rol) && (
            <Link href="/materia-prima" className="font-medium text-accent hover:underline">
              Stock de materia prima →
            </Link>
          )}
          <Link href="/catalogo/movimientos" className="font-medium text-accent hover:underline">
            Movimientos de productos →
          </Link>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {CLASES.map((c) => (
            <Chip key={c.label} href={query({ clase: c.valor })} activo={clase === c.valor} label={c.label} />
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          {FAMILIAS.map((f) => (
            <Chip key={f.label} href={query({ familia: f.valor })} activo={familia === f.valor} label={f.label} />
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <Chip href={query({ alertas: soloAlertas ? undefined : "1" })} activo={soloAlertas} label="Solo alertas" />
        </div>
        <form action="/catalogo">
          {familia && <input type="hidden" name="familia" value={familia} />}
          {clase && <input type="hidden" name="clase" value={clase} />}
          {soloAlertas && <input type="hidden" name="alertas" value="1" />}
          <input
            type="search"
            name="texto"
            defaultValue={sp.texto ?? ""}
            placeholder="Buscar por código o descripción…"
            className="input w-full sm:w-80"
          />
        </form>
        <p className="text-xs text-foreground-muted">
          {visibles.length} producto{visibles.length === 1 ? "" : "s"}
          {visibles.length !== productos.length ? ` de ${productos.length}` : ""}.
        </p>
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface px-4 py-8 text-center text-sm text-foreground-muted">
          No hay productos que coincidan.
        </p>
      ) : (
        [...grupos].map(([titulo, filas]) => (
          <section key={titulo} className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground-muted">
              {titulo} <span className="font-normal normal-case">({filas.length})</span>
            </h2>
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                      <th className="px-4 py-2.5">Código / descripción</th>
                      <th className="px-4 py-2.5">Tipo</th>
                      <th className="px-4 py-2.5">Color</th>
                      <th className="px-4 py-2.5 text-right">Stock</th>
                      <th className="px-4 py-2.5 text-right">Mínimo</th>
                      <th className="px-4 py-2.5 text-right">Máximo</th>
                      <th className="px-4 py-2.5">Estado</th>
                      <th className="px-4 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5">
                          <Link href={`/catalogo/${p.id}?existencias=1`} className="font-mono text-xs font-semibold text-accent hover:underline">
                            {p.codigo}
                          </Link>
                          <div className="font-mono text-xs text-foreground-muted">
                            {p.codigoBarras && p.codigoBarras !== p.codigo && (
                              <span title="Código de barras de la lista oficial"> · {p.codigoBarras}</span>
                            )}
                          </div>
                          <div className="text-xs text-foreground-muted">{p.descripcion}</div>
                        </td>
                        <td className="px-4 py-2.5">{etiquetaTipo(p.familia, p.tipo)}</td>
                        <td className="px-4 py-2.5 font-medium text-foreground">
                          {p.colorNombre}
                          {p.colorEspecial && <span className="ml-1 badge-estado badge-bajo">especial</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium">{fmtNumero(p.stock, 0)}</td>
                        <td className="px-4 py-2.5 text-right text-foreground-muted">{fmtNumero(p.minimo, 0)}</td>
                        <td className="px-4 py-2.5 text-right text-foreground-muted">{fmtNumero(p.maximo, 0)}</td>
                        <td className="px-4 py-2.5">
                          <Semaforo estado={p.estado} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link href={`/catalogo/${p.id}?existencias=1`} className="btn btn-outline btn-sm">
                            Ver existencias
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ))
      )}

      {comprometido.length > 0 && (
        <section id="comprometido" className="panel overflow-x-auto p-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
            <h2 className="panel-titulo mb-0 w-auto border-0">Material comprometido a entregar</h2>
            <span className="text-xs text-foreground-muted">
              {comprometido.length} productos · {comprometido.filter((c) => c.faltaProducir > 0).length} sin stock suficiente
            </span>
          </div>
          <table className="tabla mt-2">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="text-right">Comprometido</th>
                <th className="text-right">Stock</th>
                <th className="text-right">Falta producir</th>
              </tr>
            </thead>
            <tbody>
              {comprometido.map((c) => (
                <tr key={c.productoId}>
                  <td>
                    <Link href={`/catalogo/${c.productoId}`} className="font-mono text-xs text-accent hover:underline">
                      {c.codigo}
                    </Link>{" "}
                    {c.descripcion}
                  </td>
                  <td className="text-right">{fmtNumero(c.comprometido, 0)}</td>
                  <td className="text-right text-foreground-muted">{fmtNumero(c.stock, 0)}</td>
                  <td className="text-right">{c.faltaProducir > 0 ? <span className="font-semibold text-[var(--estado-critico-fg)]">{fmtNumero(c.faltaProducir, 0)}</span> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-xs text-foreground-muted">
        Mínimos y máximos según la lista del cliente; el Encargado los ajusta en Panel Admin → Stock y el semáforo se recalcula al
        instante.
      </p>
    </div>
  );
}

function Chip({ href, activo, label }: { href: string; activo: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`btn btn-sm ${activo ? "btn-azul" : "btn-outline"}`}
    >
      {label}
    </Link>
  );
}
