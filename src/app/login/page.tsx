import Image from "next/image";
import { getUsuariosPorRol } from "@/lib/data/usuarios";
import { iniciarSesionStaffAction, iniciarSesionOperarioAction } from "@/app/actions/sesion";

const ERRORES: Record<string, string> = {
  credenciales: "Email o contraseña incorrectos.",
  pin: "PIN incorrecto.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const operarios = (await getUsuariosPorRol("OPERARIO")).filter((u) => u.activo);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <Image src="/nexa-logo.png" alt="NEXA" width={140} height={91} priority />
          <p className="text-sm text-foreground-muted">Producción y stock</p>
        </div>

        {error && (
          <div className="w-full rounded-md bg-[var(--estado-critico-bg)] py-2 text-center text-sm font-medium text-[var(--estado-critico-fg)]">
            {ERRORES[error] ?? "No se pudo iniciar sesión."}
          </div>
        )}

        <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold">Administración, supervisión y gerencia</h2>
          <form action={iniciarSesionStaffAction} className="space-y-3">
            <input
              name="email"
              type="email"
              required
              placeholder="email@nexa.com.ar"
              className="input"
              autoComplete="username"
            />
            <input
              name="password"
              type="password"
              required
              placeholder="Contraseña"
              className="input"
              autoComplete="current-password"
            />
            <button
              type="submit"
              className="w-full rounded-md bg-accent py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90"
            >
              Entrar
            </button>
          </form>
        </div>

        <div className="flex items-center gap-3 text-xs text-foreground-muted">
          <div className="flex-1 border-t border-border" />o<div className="flex-1 border-t border-border" />
        </div>

        <div className="space-y-4 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-semibold">Operario — planta</h2>
          <form action={iniciarSesionOperarioAction} className="space-y-3">
            <select name="usuarioId" required className="input" defaultValue="">
              <option value="" disabled>
                Elegí tu nombre…
              </option>
              {operarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              required
              placeholder="PIN"
              className="input text-center text-lg tracking-[0.3em]"
              autoComplete="off"
            />
            <button
              type="submit"
              className="w-full rounded-md bg-brand-naranja py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              Entrar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
