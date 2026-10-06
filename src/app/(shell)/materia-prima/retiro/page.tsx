import Link from "next/link";
import { redirect } from "next/navigation";
import { ciclosParaRetiro, listarLotes, materiasPrimasActivas } from "@/lib/data/materia-prima";
import { getUsuariosPorRol } from "@/lib/data/usuarios";
import { getUsuarioActual } from "@/lib/session";
import { puedeRetirarMateriaPrima } from "@/lib/auth/permisos";
import { fmtFecha } from "@/lib/format";
import { etiquetaInyectora } from "@/lib/inyectoras";
import { FormRetiro } from "../formularios";

export default async function RetiroMpPage({ searchParams }: { searchParams: Promise<{ ciclo?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeRetirarMateriaPrima(usuario.rol)) redirect("/materia-prima");
  const sp = await searchParams;
  const [materias, lotes, ciclos, entregan] = await Promise.all([
    materiasPrimasActivas(),
    listarLotes({ soloConSaldo: true }),
    ciclosParaRetiro(),
    getUsuariosPorRol("MATERIA_PRIMA"),
  ]);
  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href="/materia-prima" className="text-sm text-foreground-muted hover:text-foreground">
          ← Materia prima
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Retiro de materia prima a máquina</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Se retira para un ciclo de producción ya iniciado: el lote queda vinculado a su partida, que es el eslabón de la
          trazabilidad. Lo habitual es entrar desde el ciclo (“Retirar materia prima para este ciclo”).
        </p>
      </div>
      <FormRetiro
        materias={materias}
        lotes={lotes.map((l) => ({ id: l.id, codigoBarra: l.codigoBarra, materiaPrimaId: l.materiaPrimaId, disponible: l.disponible }))}
        ciclos={ciclos.map((c) => ({
          id: c.id,
          etiqueta: `Ciclo #${c.id} · ${fmtFecha(c.fechaInicio)} · ${c.productoCodigo ?? "—"} · partida N° ${c.partidaNumero ?? "—"} · ${etiquetaInyectora(c.inyectora)}`,
          abierto: !c.cerrado,
        }))}
        usuarios={entregan.map((u) => ({ id: u.id, nombre: u.nombre }))}
        cicloInicial={sp.ciclo ? Number(sp.ciclo) : null}
      />
    </div>
  );
}
