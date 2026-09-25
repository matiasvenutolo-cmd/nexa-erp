import { AppShell } from "@/components/app-shell";

/**
 * Grupo de rutas autenticadas. `AppShell` llama a `getUsuarioActual()` y
 * redirige a /login sin sesión — separado del layout raíz para que no
 * envuelva también a /login ni a la página pública "/" (ver src/proxy.ts).
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
