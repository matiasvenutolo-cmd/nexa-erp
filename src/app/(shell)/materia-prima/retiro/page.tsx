import Link from "next/link";
import { redirect } from "next/navigation";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { producto, tanda } from "@/lib/db/schema";
import { etiquetaTurno } from "@/lib/data/planificacion";
import { listarLotes, materiasPrimasActivas } from "@/lib/data/materia-prima";
import { ciclosAbiertos } from "@/lib/data/maquina";
import { paraLlevarAPie, type TandaALlevar } from "@/lib/data/llevar-mp";
import { pedidosDeMaterialPendientes } from "@/lib/data/taller";
import { PedidosDeMaterial } from "@/components/pedidos-material";
import { recetasDe } from "@/lib/data/recetas";
import { getUsuariosPorRol } from "@/lib/data/usuarios";
import { getUsuarioActual } from "@/lib/session";
import { puedeRetirarMateriaPrima } from "@/lib/auth/permisos";
import { fmtFecha, fmtNumero } from "@/lib/format";
import { etiquetaInyectora } from "@/lib/inyectoras";
import { FormRetiroMaquina, type CicloRetiro } from "./form-retiro";

const DIA = { atrasada: "Atrasadas", hoy: "Hoy", manana: "Mañana", proximos: "Próximos días" } as const;

/**
 * Retiro a pie de máquina (reunión 20/11/2026): arriba, lo que hay que llevar
 * a cada máquina según la secuencia del Encargado; abajo, el registro de lo
 * que se llevó (precargado con las bolsas que faltan para toda la tanda).
 */
export default async function RetiroMpPage({ searchParams }: { searchParams: Promise<{ ciclo?: string; tanda?: string; ok?: string; pedido?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeRetirarMateriaPrima(usuario.rol)) redirect("/materia-prima");
  const sp = await searchParams;
  const [materias, lotes, abiertos, enCola, operarios, retiros, encargados, entregan, llevar] = await Promise.all([
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
    paraLlevarAPie(),
  ]);
  // Pedidos de material de las máquinas que el Encargado ya aprobó (cambios del 23/11/2026).
  const pedidosMaq = await pedidosDeMaterialPendientes({ soloAvisados: true });
  const pedidoElegido = pedidosMaq.find((p) => String(p.n.id) === sp.pedido)?.n ?? null;
  const sugeridoPedido = (cicloId: number) => {
    if (!pedidoElegido || pedidoElegido.cicloId !== cicloId || !pedidoElegido.pedido?.length) return null;
    const porMp = new Map<number, number>();
    for (const x of pedidoElegido.pedido) porMp.set(x.materiaPrimaId, Math.round(((porMp.get(x.materiaPrimaId) ?? 0) + x.kg) * 1000) / 1000);
    return [...porMp].map(([materiaPrimaId, kg]) => ({ materiaPrimaId, kg }));
  };

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
      piezasObjetivo: null,
      sugerido: sugeridoPedido(c.id),
      ...datos(c.productoCodigo),
    })),
    ...enCola.map((t) => {
      const l = llevar.find((x) => x.tandaId === t.id);
      return {
        tipo: "tanda" as const,
        id: t.id,
        etiqueta: `Tanda en cola · ${t.productoCodigo} · ${t.cantidad} u. · ${etiquetaInyectora(t.inyectora!)}${t.fecha ? ` · ${fmtFecha(t.fecha)}` : ""}${t.turno ? ` · ${etiquetaTurno(t.turno)}` : ""}`,
        piezasObjetivo: t.cantidad,
        sugerido: l ? l.materiales.filter((m) => m.faltaKg > 0).map((m) => ({ materiaPrimaId: m.materiaPrimaId, kg: m.faltaKg })) : null,
        ...datos(t.productoCodigo),
      };
    }),
  ];
  // Quién lo lleva: el de Retiros de MP (Dylan), un operario o el Encargado. Una
  // persona con varios perfiles figura una sola vez.
  const responsables = [...new Map([...retiros, ...operarios, ...encargados].map((u) => [u.id, { id: u.id, nombre: u.nombre }])).values()];
  const pendientes = llevar.filter((l) => !l.completa && l.materiales.length > 0);
  const grupos = (Object.keys(DIA) as (keyof typeof DIA)[]).map((d) => [d, llevar.filter((l) => l.dia === d)] as const).filter(([, ls]) => ls.length > 0);

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <Link href={sp.ciclo ? `/produccion/${sp.ciclo}` : "/materia-prima"} className="text-sm font-semibold text-foreground-muted hover:text-foreground">
          ← {sp.ciclo ? `Producción #${sp.ciclo}` : "Materia prima"}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Llevar material a pie de máquina</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Lo que hay que llevar a cada máquina sale de la secuencia del Encargado. Cuando el material se lleva, se registra acá: sale del stock general y queda junto a la
          inyectora. El operario lo carga en la tolva desde su pantalla.
        </p>
      </div>

      {sp.ok && <p className="aviso aviso-ok">{sp.ok}</p>}
      <PedidosDeMaterial pedidos={pedidosMaq} modo="materia-prima" />

      {!sp.ciclo && (
        <section className="space-y-3">
          <h2 className="panel-titulo">
            Para llevar a pie de máquina {pendientes.length > 0 && <span className="badge-estado badge-naranja ml-1">{pendientes.length} pendiente{pendientes.length === 1 ? "" : "s"}</span>}
          </h2>
          {llevar.length === 0 ? (
            <p className="panel text-sm text-foreground-muted">No hay tandas con máquina, día y turno asignados. Aparecen acá cuando el Encargado las programa.</p>
          ) : (
            grupos.map(([d, ls]) => (
              <div key={d} className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-foreground-muted">{DIA[d]}</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {ls.map((l) => (
                    <TarjetaLlevar key={l.tandaId} l={l} activa={sp.tanda === String(l.tandaId)} />
                  ))}
                </div>
              </div>
            ))
          )}
        </section>
      )}

      <section id="registrar" className="space-y-2">
        <h2 className="panel-titulo">Registrar lo que se llevó</h2>
        <FormRetiroMaquina
          key={sp.tanda ?? sp.ciclo ?? "nuevo"}
          ciclos={ciclos}
          materias={materias.map((m) => ({ id: m.id, nombre: m.nombre, tipo: m.tipo }))}
          lotes={lotes.map((l) => ({ id: l.id, codigoBarra: l.codigoBarra, numeroLote: l.numeroLote, materiaPrimaId: l.materiaPrimaId, disponible: l.disponible }))}
          responsables={responsables}
          entregan={entregan.map((u) => ({ id: u.id, nombre: u.nombre }))}
          inicial={sp.ciclo ? `ciclo-${sp.ciclo}` : sp.tanda ? `tanda-${sp.tanda}` : null}
          usuarioId={usuario.id}
        />
      </section>
    </div>
  );
}

function TarjetaLlevar({ l, activa }: { l: TandaALlevar; activa: boolean }) {
  return (
    <article className={`panel space-y-2 ${activa ? "border-accent" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-foreground-muted">
            {etiquetaInyectora(l.inyectora)}
            {l.fecha ? ` · ${fmtFecha(l.fecha)}` : ""}
            {l.turno ? ` · turno ${etiquetaTurno(l.turno)}` : ""}
          </div>
          <div className="font-semibold">
            {l.colorNombre ?? "—"} · {l.matriz} · {fmtNumero(l.piezas, 0)} {l.piezas === 1 ? "pieza" : "piezas"}
          </div>
          <div className="text-xs text-foreground-muted">{l.codigo}</div>
        </div>
        {l.completa ? <span className="badge-estado badge-ok">✓ Ya está</span> : l.materiales.length > 0 && <span className="badge-estado badge-naranja">Falta llevar</span>}
      </div>
      {l.materiales.length === 0 ? (
        <p className="text-sm text-foreground-muted">{l.sinReceta ? "Sin receta de carga: no se puede calcular. Avisale al Encargado." : "El producto no tiene peso por pieza: no se puede calcular."}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {l.materiales.map((m) => (
            <li key={m.materiaPrimaId} className="flex justify-between gap-3">
              <span>{m.nombre}</span>
              <span className={m.faltaKg > 0 ? "font-semibold" : "text-foreground-muted"}>{m.faltaKg > 0 ? m.texto : "✓ ya está"}</span>
            </li>
          ))}
        </ul>
      )}
      {!l.completa && l.materiales.length > 0 && (
        <Link href={`/materia-prima/retiro?tanda=${l.tandaId}#registrar`} className="btn btn-primary btn-sm">
          Registrar que se llevó
        </Link>
      )}
    </article>
  );
}
