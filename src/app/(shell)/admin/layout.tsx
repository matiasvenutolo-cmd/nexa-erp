import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { puedeVerPanelAdmin, puedeAdministrarOperarios } from "@/lib/auth/permisos";
import { SECCIONES_ADMIN } from "@/lib/admin-secciones";
import { TabsAdmin } from "./tabs-admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const usuario = await getUsuarioActual();
  if (!puedeVerPanelAdmin(usuario.rol) && !puedeAdministrarOperarios(usuario.rol)) redirect("/tablero");
  const secciones = SECCIONES_ADMIN.filter((s) => s.permiso(usuario.rol)).map(({ href, label, grupo }) => ({ href, label, grupo }));

  return (
    <div className="space-y-5">
      <TabsAdmin secciones={secciones} />
      {children}
    </div>
  );
}
