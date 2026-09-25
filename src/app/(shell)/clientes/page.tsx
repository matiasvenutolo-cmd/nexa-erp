import Link from "next/link";
import { listarClientes } from "@/lib/data/clientes";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ texto?: string }>;
}) {
  const { texto } = await searchParams;
  const clientes = await listarClientes(texto);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-brand-azul-oscuro">Clientes</h1>
        <Link
          href="/clientes/nuevo"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          + Nuevo cliente
        </Link>
      </div>

      <form action="/clientes">
        <input
          type="search"
          name="texto"
          defaultValue={texto ?? ""}
          placeholder="Buscar por nombre…"
          className="input w-full sm:w-64"
        />
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-4 py-2.5">CUIT</th>
              <th className="px-4 py-2.5">Teléfono</th>
              <th className="px-4 py-2.5">Domicilio</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-foreground">{c.nombre}</td>
                <td className="px-4 py-3 text-foreground-muted">{c.cuit ?? "—"}</td>
                <td className="px-4 py-3 text-foreground-muted">{c.telefono ?? "—"}</td>
                <td className="px-4 py-3 text-foreground-muted">
                  {[c.domicilio, c.localidad].filter(Boolean).join(", ") || "—"}
                </td>
              </tr>
            ))}
            {clientes.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-foreground-muted">
                  No hay clientes que coincidan.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
