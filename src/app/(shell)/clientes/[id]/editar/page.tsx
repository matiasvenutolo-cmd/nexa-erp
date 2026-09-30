import Link from "next/link";
import { notFound } from "next/navigation";
import { getCliente } from "@/lib/data/clientes";
import { editarClienteAction } from "@/app/actions/clientes";

const ERRORES: Record<string, string> = {
  nombre: "El nombre es obligatorio.",
  duplicado: "Ya existe un cliente con ese nombre.",
  permiso: "No tenés permiso para editar clientes.",
};

export default async function EditarClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const cliente = await getCliente(Number(id));
  if (!cliente) notFound();

  const accion = editarClienteAction.bind(null, cliente.id);

  return (
    <div className="max-w-md space-y-5">
      <div>
        <Link href="/clientes" className="text-sm text-foreground-muted hover:text-foreground">
          ← Clientes
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Editar cliente</h1>
      </div>

      {error && (
        <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">
          {ERRORES[error] ?? "No se pudo guardar el cambio."}
        </div>
      )}

      <form action={accion} className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <Campo label="Nombre" name="nombre" defaultValue={cliente.nombre} required autoFocus />
        <Campo label="CUIT" name="cuit" defaultValue={cliente.cuit} />
        <Campo label="Teléfono" name="telefono" defaultValue={cliente.telefono} />
        <Campo label="Domicilio" name="domicilio" defaultValue={cliente.domicilio} />
        <Campo label="Localidad" name="localidad" defaultValue={cliente.localidad} />
        <button
          type="submit"
          className="w-full rounded-md bg-accent py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Guardar cambios
        </button>
      </form>
    </div>
  );
}

function Campo({
  label,
  name,
  defaultValue,
  required,
  autoFocus,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-foreground-muted">{label}</span>
      <input name={name} defaultValue={defaultValue ?? ""} required={required} autoFocus={autoFocus} className="input" />
    </label>
  );
}
