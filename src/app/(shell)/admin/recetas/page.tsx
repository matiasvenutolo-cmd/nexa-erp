import Link from "next/link";
import { exigirSeccion } from "../comunes";
import { listarPresentaciones, materialesParaReceta, productosConReceta } from "@/lib/data/recetas";
import { matrizDe } from "@/lib/data/planificacion";
import { FormAccion } from "@/components/form-accion";
import { crearPresentacionAction, quitarArranqueAction } from "@/app/actions/planificacion";
import { enBolsas, fmtPeso, masterParaBase } from "@/lib/presentaciones";
import { resolverDosificacion, type Dosificacion } from "@/lib/data/dosificacion";
import { db } from "@/lib/db/client";
import { producto as productoT } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { EditorReceta } from "./editor";

/**
 * Recetas de carga en tolva (minuta 15/10/2026): el Encargado define por
 * producto y color cuántas bolsas de cada material se cargan; el operario la
 * ejecuta con un toque. Receta normal y, si hace falta, una de arranque
 * reforzada para el cambio de color.
 */
export default async function RecetasPage({ searchParams }: { searchParams: Promise<{ q?: string; producto?: string; sin?: string }> }) {
  await exigirSeccion("/admin/recetas");
  const sp = await searchParams;
  const [productos, materiales, presentaciones] = await Promise.all([productosConReceta(), materialesParaReceta(), listarPresentaciones()]);
  const q = (sp.q ?? "").trim().toLowerCase();
  const filtrados = productos.filter(
    (p) => (!q || `${p.codigo} ${p.descripcion} ${p.colorNombre ?? ""}`.toLowerCase().includes(q)) && (sp.sin !== "1" || !p.recetas.REGIMEN),
  );
  const abierto = sp.producto ? Number(sp.producto) : null;
  const prodAbierto = abierto ? productos.find((p) => p.id === abierto) : undefined;
  const [colorAbierto] = abierto ? await db.select({ colorId: productoT.colorId }).from(productoT).where(eq(productoT.id, abierto)) : [];
  const dosif = prodAbierto ? await resolverDosificacion(prodAbierto.familia, colorAbierto?.colorId ?? null) : null;
  const conReceta = productos.filter((p) => p.recetas.REGIMEN).length;

  return (
    <div className="space-y-5">
      <div className="aviso aviso-info text-sm">
        La receta se arma con presentaciones físicas (bolsas de 25 kg, bolsitas de 600 g o 750 g) y medias bolsas. El operario ve
        «2 bolsitas de 600 g», nunca kilos con decimales. Al editar una receta se muestra cuánto master corresponde según la dosificación
        vigente (Configuración → Master y dosificación); el Encargado decide las bolsas y puede agregar extras en la receta de arranque.
      </div>

      <form className="flex flex-wrap items-end gap-2" action="/admin/recetas">
        <label className="campo min-w-64 flex-1">
          <span>Buscar producto o color</span>
          <input name="q" defaultValue={sp.q ?? ""} placeholder="Ej.: negro, rejilla, 001B" className="input" />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="sin" value="1" defaultChecked={sp.sin === "1"} /> Sólo sin receta
        </label>
        <button className="btn btn-outline">Filtrar</button>
        <span className="pb-2 text-sm text-foreground-muted">
          {conReceta} de {productos.length} productos con receta
        </span>
      </form>

      <div className="panel overflow-x-auto p-0">
        <table className="tabla">
          <thead>
            <tr>
              <th>Producto y color</th>
              <th>Receta normal (por carga)</th>
              <th>Arranque (cambio de color)</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtrados.map((p) => (
              <FilaReceta key={p.id} p={p} abierto={abierto === p.id} materiales={materiales} presentaciones={presentaciones} q={sp.q} dosif={abierto === p.id ? dosif : null} />
            ))}
            {filtrados.length === 0 && (
              <tr>
                <td colSpan={4} className="text-foreground-muted">
                  Ningún producto coincide con la búsqueda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section className="panel">
        <h2 className="panel-titulo">Presentaciones</h2>
        <ul className="mb-3 flex flex-wrap gap-2 text-sm">
          {presentaciones.map((p) => (
            <li key={p.id} className="badge-estado badge-info">
              {p.nombre} · {fmtPeso(p.kg)} · {p.materiaPrimaId ? (materiales.find((m) => m.id === p.materiaPrimaId)?.nombre ?? "material") : `todo ${p.tipoMp === "MASTER" ? "master" : p.tipoMp === "VIRGEN" ? "material virgen" : (p.tipoMp ?? "").toLowerCase()}`}
            </li>
          ))}
        </ul>
        <FormAccion accion={crearPresentacionAction} boton="Agregar presentación" claseBoton="btn btn-outline" className="flex flex-wrap items-end gap-2">
          <label className="campo w-48">
            <span>Nombre</span>
            <input name="nombre" required placeholder="Bolsita 150 g" className="input" />
          </label>
          <label className="campo w-32">
            <span>Peso (gramos)</span>
            <input name="gramos" type="number" min={1} step={1} required placeholder="150" className="input" />
          </label>
          <label className="campo w-44">
            <span>Para</span>
            <select name="tipoMp" defaultValue="MASTER" className="input">
              <option value="MASTER">Todo el master</option>
              <option value="VIRGEN">Todo el material virgen</option>
              <option value="MOLIENDA">Molienda</option>
              <option value="SOBRANTE">Sobrante</option>
            </select>
          </label>
          <label className="campo min-w-56 flex-1">
            <span>…o sólo un material (opcional)</span>
            <select name="materiaPrimaId" defaultValue="" className="input">
              <option value="">—</option>
              {materiales.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </label>
        </FormAccion>
      </section>
    </div>
  );
}

type Prod = Awaited<ReturnType<typeof productosConReceta>>[number];

function FilaReceta({
  p,
  abierto,
  materiales,
  presentaciones,
  q,
  dosif,
}: {
  p: Prod;
  dosif: Dosificacion | null;
  abierto: boolean;
  materiales: Awaited<ReturnType<typeof materialesParaReceta>>;
  presentaciones: Awaited<ReturnType<typeof listarPresentaciones>>;
  q?: string;
}) {
  const r = p.recetas.REGIMEN;
  const a = p.recetas.ARRANQUE;
  const qs = (extra: string) => `/admin/recetas?${new URLSearchParams({ ...(q ? { q } : {}), ...(extra ? { producto: extra } : {}) }).toString()}`;
  const resumen = (x: typeof r) => (x ? x.items.map((i) => `${i.texto} ${i.materiaPrimaNombre}`).join(" + ") : null);
  return (
    <>
      <tr id={`p-${p.id}`}>
        <td>
          <div className="font-semibold">
            {p.colorNombre ?? "—"} · {matrizDe(p)}
          </div>
          <div className="text-xs text-foreground-muted">{p.codigo}</div>
        </td>
        <td className="text-sm">{resumen(r) ?? <span className="badge-estado badge-bajo">Sin receta</span>}</td>
        <td className="text-sm">{resumen(a) ?? <span className="text-foreground-muted">—</span>}</td>
        <td className="text-right">
          <Link href={abierto ? qs("") : `${qs(String(p.id))}#p-${p.id}`} className="btn btn-outline btn-sm" scroll={false}>
            {abierto ? "Cerrar" : r ? "Editar" : "Definir"}
          </Link>
        </td>
      </tr>
      {abierto && (
        <tr>
          <td colSpan={4} className="bg-surface-muted">
            <AyudaDosificacion d={dosif} r={r} presentaciones={presentaciones} />
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-semibold text-brand-azul">Receta normal de producción</h3>
                <EditorReceta productoId={p.id} tipo="REGIMEN" inicial={r?.items.map((i) => ({ materiaPrimaId: i.materiaPrimaId, presentacionId: i.presentacionId, cantidad: i.cantidad })) ?? []} materiales={materiales} presentaciones={presentaciones} />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold text-brand-azul">Receta de arranque (cambio de color, opcional)</h3>
                <EditorReceta
                  productoId={p.id}
                  tipo="ARRANQUE"
                  inicial={(a ?? r)?.items.map((i) => ({ materiaPrimaId: i.materiaPrimaId, presentacionId: i.presentacionId, cantidad: i.cantidad })) ?? []}
                  materiales={materiales}
                  presentaciones={presentaciones}
                />
                {a && (
                  <FormAccion accion={quitarArranqueAction} ocultos={{ productoId: p.id }} boton="Quitar la receta de arranque" claseBoton="btn btn-ghost btn-sm" className="mt-2" />
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Cuánto master corresponde a la receta actual según la dosificación vigente. */
function AyudaDosificacion({ d, r, presentaciones }: { d: Dosificacion | null; r: Prod["recetas"]["REGIMEN"]; presentaciones: Awaited<ReturnType<typeof listarPresentaciones>> }) {
  if (!d) return <p className="aviso aviso-alerta mb-3 text-sm">No hay dosificación de master para este tipo de piso (Configuración → Master y dosificación).</p>;
  const presMaster = presentaciones.filter((x) => x.tipoMp === "MASTER").map((x) => ({ nombre: x.nombre, kg: x.kg }));
  const regla = `${Math.round(d.gPorKgMp * d.kgReferencia * 1000) / 1000} g de master cada ${String(d.kgReferencia).replace(".", ",")} kg de ${d.materiaPrimaBase2Nombre ? `${d.materiaPrimaBaseNombre ?? "base"} + ${d.materiaPrimaBase2Nombre}` : (d.materiaPrimaBaseNombre ?? "material base")}`;
  const esperado = r ? masterParaBase(r.kgVirgen, d.gPorKgMp) : null;
  return (
    <div className="aviso aviso-info mb-3 space-y-1 text-sm">
      <p>
        Dosificación {d.origen === "excepcion" ? `de ${d.colorNombre}` : "general"}: <b>{regla}</b> (= {Math.round(d.gPorKgMp * 100) / 100} g por kg).
      </p>
      {r && esperado != null && (
        <p>
          Con {fmtPeso(r.kgVirgen)} de material base por carga corresponden <b>{fmtPeso(esperado, { gramos: true })}</b> de master
          {enBolsas(esperado, presMaster) ? ` (${enBolsas(esperado, presMaster)})` : ""}; la receta tiene {fmtPeso(r.kgMaster, { gramos: true })}.
        </p>
      )}
      {d.materiaPrimaBase2Id && d.proporcionBase1 == null && <p className="text-[var(--estado-bajo-fg)]">La proporción entre los dos materiales de la mezcla todavía no está definida: las bolsas de cada uno las decide el Encargado.</p>}
    </div>
  );
}
