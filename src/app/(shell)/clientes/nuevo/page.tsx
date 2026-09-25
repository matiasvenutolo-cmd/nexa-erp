import Link from "next/link";
import { crearClienteAction } from "@/app/actions/clientes";

const ERRORES: Record<string, string> = {
  nombre: "El nombre es obligatorio.",
  duplicado: "Ya existe un cliente con ese nombre.",
};

export default async function NuevoClientePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="max-w-md space-y-5">
      <div>
        <Link href="/clientes" className="text-sm text-foreground-muted hover:text-foreground">
          ← Clientes
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Nuevo cliente</h1>
      </div>

      {error && (
        <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">
          {ERRORES[error] ?? "No se pudo crear el cliente."}
        </div>
      )}

      <form action={crearClienteAction} className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <Campo label="Nombre" name="nombre" required autoFocus />
        <Campo label="CUIT" name="cuit" />
        <Campo label="Teléfono" name="telefono" />
        <Campo label="Domicilio" name="domicilio" />
        <Campo label="Localidad" name="localidad" />
        <button
          type="submit"
          className="w-full rounded-md bg-accent py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
        >
          Crear cliente
        </button>
      </form>
    </div>
  );
}

function Campo({
  label,
  name,
  required,
  autoFocus,
}: {
  label: string;
  name: string;
  required?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-foreground-muted">{label}</span>
      <input name={name} required={required} autoFocus={autoFocus} className="input" />
    </label>
  );
}
