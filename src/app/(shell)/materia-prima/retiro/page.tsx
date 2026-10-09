import Link from "next/link";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { color, producto } from "@/lib/db/schema";
import { listarLotes, materiasPrimasActivas } from "@/lib/data/materia-prima";
import { ciclosAbiertos } from "@/lib/data/maquina";
import { resolverDosificacion } from "@/lib/data/dosificacion";
import { getUsuariosPorRol } from "@/lib/data/usuarios";
import { getUsuarioActual } from "@/lib/session";
import { puedeRetirarMateriaPrima } from "@/lib/auth/permisos";
import { fmtFecha } from "@/lib/format";
import { etiquetaInyectora } from "@/lib/inyectoras";
import { FormRetiroMaquina, type CicloRetiro } from "./form-retiro";

export default async function RetiroMpPage({ searchParams }: { searchParams: Promise<{ ciclo?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeRetirarMateriaPrima(usuario.rol)) redirect("/materia-prima");
  const sp = await searchParams;
  const [materias, lotes, abiertos, operarios, retiros, encargados, entregan] = await Promise.all([
    materiasPrimasActivas(),
    listarLotes({ soloConSaldo: true }),
    ciclosAbiertos(),
    getUsuariosPorRol("OPERARIO"),
    getUsuariosPorRol("RETIROS_MP"),
    getUsuariosPorRol("ENCARGADO"),
    getUsuariosPorRol("MATERIA_PRIMA"),
  ]);

  // Por ciclo: producto, peso por pieza, material base y master configurados.
  const productos = abiertos.length
    ? await db
        .select({
          cicloProductoCodigo: producto.codigo,
          id: producto.id,
          numero: producto.numero,
          familia: producto.familia,
          colorId: producto.colorId,
          kg: producto.kgPorUnidad,
          masterMpId: color.masterMateriaPrimaId,
        })
        .from(producto)
        .leftJoin(color, eq(producto.colorId, color.id))
        .where(inArray(producto.codigo, abiertos.map((c) => c.productoCodigo ?? "")))
    : [];
  const ciclos: CicloRetiro[] = await Promise.all(
    abiertos.map(async (c) => {
      const p = productos.find((x) => x.cicloProductoCodigo === c.productoCodigo);
      const d = p?.familia ? await resolverDosificacion(p.familia, p.colorId) : null;
      const base = d?.materiaPrimaBaseNombre ? materias.find((m) => m.nombre === d.materiaPrimaBaseNombre) : undefined;
      return {
        id: c.id,
        etiqueta: `Ciclo #${c.id} · ${fmtFecha(c.fechaInicio)} · ${c.productoCodigo ?? "—"} · partida N° ${c.partidaNumero ?? "—"} · ${etiquetaInyectora(c.inyectora)}`,
        productoNumero: p?.numero ?? null,
        kgPorPieza: p?.kg != null && Number(p.kg) > 0 ? Number(p.kg) : null,
        gPorKgMp: d?.gPorKgMp ?? null,
        materialBaseId: base?.id ?? null,
        masterMpId: p?.masterMpId ?? null,
      };
    }),
  );
  const responsables = [...operarios, ...retiros, ...encargados].map((u) => ({ id: u.id, nombre: u.nombre }));

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <Link href="/materia-prima" className="text-sm text-foreground-muted hover:text-foreground">
          ← Materia prima
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Retiro de materia prima a pie de máquina</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Movimiento A: el material sale del depósito y queda junto a la inyectora. La carga en la tolva se registra después,
          desde el retiro o desde el ciclo, a medida que se usa (puede pasar de un turno a otro).
        </p>
      </div>
      <FormRetiroMaquina
        ciclos={ciclos}
        materias={materias.map((m) => ({ id: m.id, nombre: m.nombre, tipo: m.tipo }))}
        lotes={lotes.map((l) => ({ id: l.id, codigoBarra: l.codigoBarra, numeroLote: l.numeroLote, materiaPrimaId: l.materiaPrimaId, disponible: l.disponible }))}
        responsables={responsables}
        entregan={entregan.map((u) => ({ id: u.id, nombre: u.nombre }))}
        cicloInicial={sp.ciclo ? Number(sp.ciclo) : null}
      />
    </div>
  );
}
