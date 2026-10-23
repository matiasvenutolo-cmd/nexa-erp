import Image from "next/image";
import { usuariosConPin } from "@/lib/data/usuarios";
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
  const operarios = await usuariosConPin();

  return (
    <div className="min-h-screen">
      <div className="brand-stripe" />
      <div className="flex min-h-[calc(100vh-3px)] items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <span className="rounded-xl border border-[rgba(0,32,148,0.1)] bg-white px-4 py-2 shadow-sm">
            <Image src="/nexa-logo.png" alt="NEXA" width={120} height={78} priority className="h-14 w-auto" />
          </span>
          <h1 className="text-2xl">Producción y stock</h1>
        </div>

        {error && (
          <div className="aviso aviso-error text-center">
            {ERRORES[error] ?? "No se pudo iniciar sesión."}
          </div>
        )}

        <div className="panel space-y-4">
          <h2 className="panel-titulo mb-0">Oficina, supervisión y gerencia</h2>
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
            <button type="submit" className="btn btn-primary btn-block">
              Entrar
            </button>
          </form>
        </div>

        <div className="flex items-center gap-3 text-xs text-foreground-muted">
          <div className="flex-1 border-t border-border" />o<div className="flex-1 border-t border-border" />
        </div>

        <div className="panel space-y-4">
          <h2 className="panel-titulo mb-0">Planta (operarios)</h2>
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
            <button type="submit" className="btn btn-azul btn-lg btn-block">
              Entrar a mi turno
            </button>
          </form>
        </div>
      </div>
      </div>
    </div>
  );
}
