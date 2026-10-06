import Link from "next/link";
import { redirect } from "next/navigation";
import { materiasPrimasActivas } from "@/lib/data/materia-prima";
import { getUsuarioActual } from "@/lib/session";
import { puedeIngresarMateriaPrima } from "@/lib/auth/permisos";
import { FormIngreso } from "../formularios";
import { hoyISO } from "@/lib/format";

export default async function IngresoMpPage() {
  const usuario = await getUsuarioActual();
  if (!puedeIngresarMateriaPrima(usuario.rol)) redirect("/materia-prima");
  const materias = await materiasPrimasActivas();
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/materia-prima" className="text-sm text-foreground-muted hover:text-foreground">
          ← Materia prima
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Ingreso de materia prima</h1>
      </div>
      <FormIngreso materias={materias} hoy={hoyISO()} />
    </div>
  );
}
