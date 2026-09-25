import Link from "next/link";
import { listarProductos } from "@/lib/data/catalogo";
import { Semaforo } from "@/components/semaforo";
import { fmtNumero } from "@/lib/format";

const FAMILIAS = [
  { valor: undefined, label: "Todos" },
  { valor: "REJILLA" as const, label: "Rejilla" },
  { valor: "CIEGO" as const, label: "Ciego" },
];

export default async function CatalogoPage({
  searchParams,
}: {
  searchParams: Promise<{ familia?: string; texto?: string; alertas?: string }>;
}) {
  const sp = await searchParams;
  const familia = sp.familia === "REJILLA" || sp.familia === "CIEGO" ? sp.familia : undefined;
  const soloAlertas = sp.alertas === "1";

  const productos = await listarProductos({ familia, texto: sp.texto });
  const visibles = soloAlertas
    ? productos.filter((p) => p.estado === "critico" || p.estado === "bajo")
    : productos;

  const query = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { familia: sp.familia, texto: sp.texto, alertas: sp.alertas, ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const qs = p.toString();
    return qs ? `/catalogo?${qs}` : "/catalogo";
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-semibold text-brand-azul-oscuro">Catálogo</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {FAMILIAS.map((f) => (
            <Link
              key={f.label}
              href={query({ familia: f.valor })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                familia === f.valor
                  ? "bg-accent text-accent-foreground"
                  : "bg-surface-muted text-foreground-muted hover:text-foreground"
              }`}
            >
              {f.label}
            </Link>
          ))}
          <Link
            href={query({ alertas: soloAlertas ? undefined : "1" })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              soloAlertas ? "bg-accent text-accent-foreground" : "bg-surface-muted text-foreground-muted hover:text-foreground"
            }`}
          >
            Solo alertas
          </Link>
        </div>
        <form action="/catalogo" className="flex-1 sm:flex-none">
          {familia && <input type="hidden" name="familia" value={familia} />}
          {soloAlertas && <input type="hidden" name="alertas" value="1" />}
          <input
            type="search"
            name="texto"
            defaultValue={sp.texto ?? ""}
            placeholder="Buscar por código o descripción…"
            className="input w-full sm:w-64"
          />
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <th className="px-4 py-2.5">Código</th>
              <th className="px-4 py-2.5">Descripción</th>
              <th className="px-4 py-2.5">Color</th>
              <th className="px-4 py-2.5 text-right">Stock</th>
              <th className="px-4 py-2.5 text-right">Mínimo</th>
              <th className="px-4 py-2.5">Estado</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((p) => (
              <tr key={p.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-foreground-muted">{p.codigo}</td>
                <td className="px-4 py-3 font-medium text-foreground">{p.descripcion}</td>
                <td className="px-4 py-3 text-foreground-muted">{p.colorNombre}</td>
                <td className="px-4 py-3 text-right">{fmtNumero(p.stock, 0)}</td>
                <td className="px-4 py-3 text-right text-foreground-muted">{fmtNumero(p.minimo, 0)}</td>
                <td className="px-4 py-3">
                  <Semaforo estado={p.estado} />
                </td>
              </tr>
            ))}
            {visibles.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-foreground-muted">
                  No hay productos que coincidan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-foreground-muted">
        Los mínimos son los importados del Excel — el semáforo se termina de calibrar cuando el
        cliente confirme los valores reales (docs/01-analisis.md §6, pregunta 1).
      </p>
    </div>
  );
}
