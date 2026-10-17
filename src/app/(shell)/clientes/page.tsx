import Link from "next/link";
import { listarClientes } from "@/lib/data/clientes";
import { getUsuarioActual } from "@/lib/session";
import { puedeCrearPedido } from "@/lib/auth/permisos";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ texto?: string; orden?: string }>;
}) {
  const { texto, orden } = await searchParams;
  const za = orden === "za";
  const [clientes, usuario] = await Promise.all([listarClientes(texto, za ? "za" : "az"), getUsuarioActual()]);
  const puedeEditar = puedeCrearPedido(usuario.rol);

  return (
    <div className="space-y-5">
      <div className="encabezado mb-0">
        <div>
          <h1>Clientes</h1>
          <p>Entrá a cada cliente para ver su historial de pedidos.</p>
        </div>
        <Link href="/clientes/nuevo" className="btn btn-primary">
          + Nuevo cliente
        </Link>
      </div>

      <form action="/clientes" className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground-muted">Ordenar por nombre:</span>
        <Link href={`/clientes${texto ? `?texto=${encodeURIComponent(texto)}` : ""}`} className={`btn btn-sm ${!za ? "btn-azul" : "btn-outline"}`}>
          A → Z
        </Link>
        <Link href={`/clientes?orden=za${texto ? `&texto=${encodeURIComponent(texto)}` : ""}`} className={`btn btn-sm ${za ? "btn-azul" : "btn-outline"}`}>
          Z → A
        </Link>
        {za && <input type="hidden" name="orden" value="za" />}
        <input
          type="search"
          name="texto"
          defaultValue={texto ?? ""}
          placeholder="Buscar por nombre…"
          className="input w-full sm:w-64"
        />
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              <th className="px-4 py-2.5">Nombre</th>
              <th className="px-4 py-2.5">CUIT</th>
              <th className="px-4 py-2.5">Teléfono</th>
              <th className="px-4 py-2.5">Domicilio</th>
              {puedeEditar && <th className="px-4 py-2.5" />}
            </tr>
          </thead>
          <tbody>
            {clientes.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">
                  <Link href={`/clientes/${c.id}`} className="font-semibold text-foreground hover:text-accent">
                    {c.nombre}
                  </Link>
                </td>
                <td className="px-4 py-3 text-foreground-muted">{c.cuit ?? "—"}</td>
                <td className="px-4 py-3 text-foreground-muted">{c.telefono ?? "—"}</td>
                <td className="px-4 py-3 text-foreground-muted">
                  {[c.domicilio, c.localidad].filter(Boolean).join(", ") || "—"}
                </td>
                {puedeEditar && (
                  <td className="px-4 py-3 text-right">
                    <Link href={`/clientes/${c.id}`} className="mr-3 text-sm font-medium text-accent hover:underline">
                      Historial
                    </Link>
                    <Link href={`/clientes/${c.id}/editar`} className="text-sm font-medium text-accent hover:underline">
                      Editar
                    </Link>
                  </td>
                )}
              </tr>
            ))}
            {clientes.length === 0 && (
              <tr>
                <td colSpan={puedeEditar ? 5 : 4} className="px-4 py-8 text-center text-foreground-muted">
                  No hay clientes que coincidan.
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
