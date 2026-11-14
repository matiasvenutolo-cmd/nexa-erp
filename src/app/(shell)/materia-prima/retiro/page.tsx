import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { producto, tanda } from "@/lib/db/schema";
import { etiquetaTurno } from "@/lib/data/planificacion";
import { listarLotes, materiasPrimasActivas } from "@/lib/data/materia-prima";
import { ciclosAbiertos } from "@/lib/data/maquina";
import { recetasDe } from "@/lib/data/recetas";
import { getUsuariosPorRol } from "@/lib/data/usuarios";
import { getUsuarioActual } from "@/lib/session";
import { puedeRetirarMateriaPrima } from "@/lib/auth/permisos";
import { fmtFecha } from "@/lib/format";
import { etiquetaInyectora } from "@/lib/inyectoras";
import { FormRetiroMaquina, type CicloRetiro } from "./form-retiro";

export default async function RetiroMpPage({ searchParams }: { searchParams: Promise<{ ciclo?: string; tanda?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeRetirarMateriaPrima(usuario.rol)) redirect("/materia-prima");
  const sp = await searchParams;
  const [materias, lotes, abiertos, enCola, operarios, retiros, encargados, entregan] = await Promise.all([
    materiasPrimasActivas(),
    listarLotes({ soloConSaldo: true }),
    ciclosAbiertos(),
    // Tandas en cola con máquina: el material se puede llevar antes de que el operario arranque.
    db
      .select({ id: tanda.id, inyectora: tanda.inyectora, fecha: tanda.fecha, turno: tanda.turno, productoCodigo: producto.codigo, cantidad: sql<number>`${tanda.cantidadPedidos} + ${tanda.cantidadStock}`.mapWith(Number) })
      .from(tanda)
      .innerJoin(producto, eq(tanda.productoId, producto.id))
      .where(and(eq(tanda.estado, "PLANIFICADA"), isNotNull(tanda.inyectora)))
      .orderBy(sql`${tanda.fecha} asc nulls last`, asc(tanda.orden)),
    getUsuariosPorRol("OPERARIO"),
    getUsuariosPorRol("RETIROS_MP"),
    getUsuariosPorRol("ENCARGADO"),
    getUsuariosPorRol("MATERIA_PRIMA"),
  ]);

  // Por destino: producto, peso por pieza y receta de carga.
  const codigos = [...abiertos.map((c) => c.productoCodigo ?? ""), ...enCola.map((t) => t.productoCodigo)];
  const productos = codigos.length
    ? await db.select({ codigo: producto.codigo, id: producto.id, numero: producto.numero, kg: producto.kgPorUnidad }).from(producto).where(inArray(producto.codigo, codigos))
    : [];
  // Sugerencia de material: la receta de carga del producto (no la dosificación anterior en g/kg).
  const recetas = await recetasDe(productos.map((p) => p.id));
  const datos = (codigo: string | null) => {
    const p = productos.find((x) => x.codigo === codigo);
    const r = p ? recetas.get(p.id)?.REGIMEN : undefined;
    return {
      productoNumero: p?.numero ?? null,
      kgPorPieza: p?.kg != null && Number(p.kg) > 0 ? Number(p.kg) : null,
      receta: r ? r.items.map((i) => ({ materiaPrimaId: i.materiaPrimaId, kg: i.kg, esMaster: i.esMaster, texto: `${i.texto} ${i.materiaPrimaNombre}` })) : null,
      kgVirgenPorCarga: r?.kgVirgen ?? null,
    };
  };
  const ciclos: CicloRetiro[] = [
    ...abiertos.map((c) => ({
      tipo: "ciclo" as const,
      id: c.id,
      etiqueta: `Producción #${c.id} · ${fmtFecha(c.fechaInicio)} · ${c.productoCodigo ?? "—"} · partida ${c.partidaNumero ?? "—"} · ${etiquetaInyectora(c.inyectora)}`,
      ...datos(c.productoCodigo),
    })),
    ...enCola.map((t) => ({
      tipo: "tanda" as const,
      id: t.id,
      etiqueta: `Tanda en cola · ${t.productoCodigo} · ${t.cantidad} u. · ${etiquetaInyectora(t.inyectora!)}${t.fecha ? ` · ${fmtFecha(t.fecha)}` : ""}${t.turno ? ` · ${etiquetaTurno(t.turno)}` : ""}`,
      ...datos(t.productoCodigo),
    })),
  ];
  // Una persona con varios perfiles (ej. Retiros de MP y Encargado) figura una sola vez.
  const responsables = [...new Map([...operarios, ...retiros, ...encargados].map((u) => [u.id, { id: u.id, nombre: u.nombre }])).values()];

  return (
    <div className="max-w-4xl space-y-5">
      <div>
        <Link href={sp.ciclo ? `/produccion/${sp.ciclo}` : "/materia-prima"} className="text-sm font-semibold text-foreground-muted hover:text-foreground">
          ← {sp.ciclo ? `Producción #${sp.ciclo}` : "Materia prima"}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Retiro de materia prima a pie de máquina</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Movimiento A: el material sale del depósito y queda junto a la inyectora. La carga en la tolva se registra después,
          desde la pantalla del operario o desde la producción, a medida que se usa (puede pasar de un turno a otro).
        </p>
      </div>
      <FormRetiroMaquina
        ciclos={ciclos}
        materias={materias.map((m) => ({ id: m.id, nombre: m.nombre, tipo: m.tipo }))}
        lotes={lotes.map((l) => ({ id: l.id, codigoBarra: l.codigoBarra, numeroLote: l.numeroLote, materiaPrimaId: l.materiaPrimaId, disponible: l.disponible }))}
        responsables={responsables}
        entregan={entregan.map((u) => ({ id: u.id, nombre: u.nombre }))}
        inicial={sp.ciclo ? `ciclo-${sp.ciclo}` : sp.tanda ? `tanda-${sp.tanda}` : null}
      />
    </div>
  );
}
