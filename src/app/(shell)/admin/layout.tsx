import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { puedeVerPanelAdmin } from "@/lib/auth/permisos";
import { SECCIONES_ADMIN } from "@/lib/admin-secciones";
import { TabsAdmin } from "./tabs-admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const usuario = await getUsuarioActual();
  if (!puedeVerPanelAdmin(usuario.rol)) redirect("/tablero");
  const secciones = SECCIONES_ADMIN.filter((s) => s.permiso(usuario.rol)).map(({ href, label }) => ({ href, label }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-brand-azul-oscuro">Panel Admin</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Parámetros que cambian con el negocio. Cada cambio queda registrado con quién y cuándo, y se
          aplica en todo el sistema al guardarlo.
        </p>
      </div>
      <TabsAdmin secciones={secciones} />
      {children}
    </div>
  );
}
