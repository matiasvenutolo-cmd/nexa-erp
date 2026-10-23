import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { SECCIONES_ADMIN } from "@/lib/admin-secciones";
import { TabsAdmin } from "./tabs-admin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const usuario = await getUsuarioActual();
  const secciones = SECCIONES_ADMIN.filter((s) => s.permiso(usuario.rol)).map(({ href, label, grupo }) => ({ href, label, grupo }));
  if (secciones.length === 0) redirect("/tablero");

  return (
    <div className="space-y-5">
      <TabsAdmin secciones={secciones} />
      {children}
    </div>
  );
}
