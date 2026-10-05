import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { SECCIONES_ADMIN } from "@/lib/admin-secciones";

export default async function AdminPage() {
  const usuario = await getUsuarioActual();
  const primera = SECCIONES_ADMIN.find((s) => s.permiso(usuario.rol));
  redirect(primera?.href ?? "/tablero");
}
