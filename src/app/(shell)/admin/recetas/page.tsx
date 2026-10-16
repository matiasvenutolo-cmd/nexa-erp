import Link from "next/link";
import { exigirSeccion } from "../comunes";
import { listarPresentaciones, materialesParaReceta, productosConReceta } from "@/lib/data/recetas";
import { matrizDe } from "@/lib/data/planificacion";
import { FormAccion } from "@/components/form-accion";
import { crearPresentacionAction, quitarArranqueAction } from "@/app/actions/planificacion";
import { fmtPeso } from "@/lib/presentaciones";
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
  const conReceta = productos.filter((p) => p.recetas.REGIMEN).length;

  return (
    <div className="space-y-5">
      <div className="aviso aviso-info text-sm">
        La receta se arma con presentaciones físicas (bolsas de 25 kg, bolsitas de 600 g o 750 g) y medias bolsas. El operario ve
        «2 bolsitas de 600 g», nunca kilos con decimales. <b>No se calcula desde la dosificación anterior en g/kg</b>: esa definición
        no coincide con las cargas de la planilla (ver Configuración → Master).
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
              <FilaReceta key={p.id} p={p} abierto={abierto === p.id} materiales={materiales} presentaciones={presentaciones} q={sp.q} />
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
}: {
  p: Prod;
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
