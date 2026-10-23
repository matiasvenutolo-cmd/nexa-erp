import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/session";
import { puedeAltaMateriaPrima, puedeCorregirProduccionMp, puedeVerMateriaPrima } from "@/lib/auth/permisos";
import { FormAccion } from "@/components/form-accion";
import { editarMpAction } from "@/app/actions/materia-prima";
import { listarLotes } from "@/lib/data/materia-prima";
import { movimientosMp, stockMpPorUbicacion } from "@/lib/data/stock-mp";
import { fmtFecha, fmtFechaHora, fmtNumero } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";
import { CorregirLote } from "../corregir-lote";

/**
 * Una materia prima: su saldo en cada depósito, sus lotes y certificados de
 * calidad (con lo disponible de cada uno) y sus movimientos. Trazabilidad del
 * certificado al lote, la producción y la caja desde cada lote.
 */
export default async function MateriaPrimaDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeVerMateriaPrima(usuario.rol)) redirect("/tablero");
  const { id } = await params;
  const mp = (await stockMpPorUbicacion()).find((m) => m.id === Number(id));
  if (!mp) notFound();
  const [lotes, movs] = await Promise.all([listarLotes({ materiaPrimaId: mp.id }), movimientosMp({ materiaPrimaId: mp.id, limite: 40 })]);
  const corrige = puedeCorregirProduccionMp(usuario.rol);
  const g = mp.tipo === "MASTER";
  return (
    <div className="space-y-5">
      <div>
        <Link href="/materia-prima" className="text-sm font-semibold text-foreground-muted hover:text-foreground">
          ← Materia prima
        </Link>
        <h1 className="mt-1 text-[1.6rem]">{mp.nombre}</h1>
        <p className="text-sm text-foreground-muted">Código {mp.codigo}</p>
        {puedeAltaMateriaPrima(usuario.rol) && (
          <details className="mt-2 text-sm">
            <summary className="cursor-pointer font-semibold text-accent">Corregir código o nombre</summary>
            <FormAccion accion={editarMpAction} boton="Guardar" ocultos={{ id: mp.id }} className="mt-2 flex flex-wrap items-end gap-2">
              <label className="campo w-28">
                <span>Código</span>
                <input name="codigoInterno" defaultValue={mp.codigo} required className="input" />
              </label>
              <label className="campo min-w-64 flex-1">
                <span>Nombre</span>
                <input name="nombre" defaultValue={mp.nombre} required className="input" />
              </label>
              <label className="campo min-w-48">
                <span>Motivo</span>
                <input name="motivo" className="input" />
              </label>
            </FormAccion>
          </details>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="stat-card">
          <div className="stat-label">Stock general</div>
          <div className="stat-valor">{fmtPeso(mp.deposito, { gramos: g && mp.deposito < 10 })}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">A pie de máquina</div>
          <div className="stat-valor">{fmtPeso(mp.pie, { gramos: g && mp.pie < 10 })}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">En tolva</div>
          <div className="stat-valor">{fmtPeso(mp.proceso, { gramos: g && mp.proceso < 10 })}</div>
        </div>
      </div>

      <section className="panel overflow-x-auto p-0">
        <div className="px-5 pt-4">
          <h2 className="panel-titulo">Lotes y certificados de calidad</h2>
          <p className="mb-3 text-xs text-foreground-muted">
            Lote de MP = código de ingreso (27 dígitos). Lote del proveedor = sus últimos 12 dígitos. La partida NEXA es otra cosa: agrupa lo producido.
          </p>
        </div>
        <table className="tabla">
          <thead>
            <tr>
              <th>Lote de MP (código)</th>
              <th>Lote del proveedor</th>
              <th>Certificado</th>
              <th>Ingreso</th>
              <th className="text-right">Ingresado</th>
              <th className="text-right">Disponible</th>
              {corrige && <th></th>}
            </tr>
          </thead>
          <tbody>
            {lotes.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/trazabilidad?tipo=lote&valor=${l.codigoBarra}`} className="font-mono text-xs text-accent hover:underline">
                    {l.codigoBarra}
                  </Link>
                </td>
                <td className="font-mono text-xs">{l.numeroLote}</td>
                <td>{l.certificadoNumero ? `N° ${l.certificadoNumero} · ${l.proveedor}` : "—"}</td>
                <td>{fmtFecha(l.fechaIngreso)}</td>
                <td className="text-right tabular-nums">{fmtNumero(l.ingresado, 3)} kg</td>
                <td className="text-right font-semibold tabular-nums">{fmtNumero(l.disponible, 3)} kg</td>
                {corrige && (
                  <td>
                    <CorregirLote loteId={l.id} ingresado={Number(l.ingresado)} />
                  </td>
                )}
              </tr>
            ))}
            {lotes.length === 0 && (
              <tr>
                <td colSpan={7} className="text-foreground-muted">
                  Esta materia prima no tiene lotes ingresados (el stock importado del Excel no tiene lote).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel overflow-x-auto p-0">
        <h2 className="panel-titulo mx-5 mt-4">Movimientos (entradas y salidas de cada depósito)</h2>
        <table className="tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Depósito</th>
              <th className="text-right">Kg</th>
              <th>Origen</th>
              <th>Observaciones</th>
              <th>Responsable</th>
            </tr>
          </thead>
          <tbody>
            {movs.map((m) => (
              <tr key={m.id}>
                <td className="whitespace-nowrap text-xs">{fmtFechaHora(m.fecha)}</td>
                <td className="whitespace-nowrap">{m.ubicacion}</td>
                <td className={`text-right font-semibold tabular-nums ${m.kg < 0 ? "text-[var(--estado-critico-fg)]" : "text-[var(--estado-ok-fg)]"}`}>
                  {m.kg > 0 ? "+" : ""}
                  {fmtNumero(m.kg, 3)}
                </td>
                <td className="whitespace-nowrap">{m.origen}</td>
                <td className="max-w-80 text-xs text-foreground-muted">{m.motivo}</td>
                <td className="whitespace-nowrap">{m.usuario}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
