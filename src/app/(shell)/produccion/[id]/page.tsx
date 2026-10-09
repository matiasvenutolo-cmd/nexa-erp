import { notFound } from "next/navigation";
import Link from "next/link";
import { cajasDeCiclo, obtenerCiclo, resumenParaCiclo } from "@/lib/data/produccion";
import { etiquetaInyectora } from "@/lib/inyectoras";
import { resolverDosificacion } from "@/lib/data/dosificacion";
import { codigoDeUso, listarRetiros } from "@/lib/data/materia-prima";
import { ciclosAbiertos, codigosDeSobrante, controlMaterialCiclo, obtenerRetirosMaquina } from "@/lib/data/maquina";
import { getUsuarioActual } from "@/lib/session";
import { puedeCorregirProduccionMp, puedeRetirarMateriaPrima } from "@/lib/auth/permisos";
import { fmtNumero, fmtFecha, fmtDia } from "@/lib/format";
import { OperacionesRetiro } from "@/components/operaciones-retiro";
import { FormularioCierre } from "./formulario-cierre";
import { CorreccionCierre } from "./correccion";

/**
 * Un ciclo es la producción de una jornada en una inyectora, dentro de una
 * partida (que puede seguir al día siguiente). Pasos: inicio → retiro de MP a
 * pie de máquina → carga en tolva → producción, devoluciones y sobrantes →
 * cierre del día.
 */
export default async function CicloPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const usuario = await getUsuarioActual();
  const ciclo = await obtenerCiclo(Number(id));
  if (!ciclo) notFound();
  const dosificacion = ciclo.productoFamilia ? await resolverDosificacion(ciclo.productoFamilia, ciclo.productoColorId) : null;
  const abierto = ciclo.fechaFin == null;
  const [cajas, legado, retiros, control, resumen, abiertos, sobrantes] = await Promise.all([
    cajasDeCiclo(ciclo.id),
    listarRetiros({ cicloId: ciclo.id }).then((rs) => rs.filter((r) => r.retiroMaquinaId == null)),
    obtenerRetirosMaquina({ cicloId: ciclo.id }),
    controlMaterialCiclo(ciclo.id),
    abierto && ciclo.productoId ? resumenParaCiclo(ciclo.productoId) : Promise.resolve(null),
    ciclosAbiertos(),
    codigosDeSobrante(),
  ]);
  const inyectora = ciclo.inyectora.replace(/inyectora/i, "").trim();
  const ciclosCarga = abiertos
    .filter((c) => c.inyectora.replace(/inyectora/i, "").trim() === inyectora)
    .map((c) => ({ id: c.id, etiqueta: `Ciclo #${c.id} · ${fmtFecha(c.fechaInicio)} · ${c.productoCodigo ?? "—"}` }));
  const puedeOperar = puedeRetirarMateriaPrima(usuario.rol);
  const puedeCorregir = puedeCorregirProduccionMp(usuario.rol);
  const hayCarga = (control?.cargado ?? 0) > 0;

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <Link href="/produccion" className="text-sm text-foreground-muted hover:text-foreground">
          ← Producción
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">
          Ciclo #{ciclo.id} — {ciclo.productoCodigo} · {ciclo.productoDescripcion}
        </h1>
        <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
          <li>✓ 1. Inicio (partida N° {ciclo.partidaNumero ?? "—"})</li>
          <li>{retiros.length > 0 || legado.length > 0 ? "✓" : "○"} 2. Retiro de MP a pie de máquina</li>
          <li>{hayCarga ? "✓" : "○"} 3. Carga en tolva</li>
          <li>{abierto ? "○" : "✓"} 4. Producción, devoluciones y sobrantes</li>
          <li>{abierto ? "○" : "✓"} 5. Cierre del día{abierto ? "" : " — producción ingresada al stock en cajas"}</li>
        </ol>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-4">
        <Dato label="Inicio" valor={fmtFecha(ciclo.fechaInicio)} />
        <Dato label="Inyectora" valor={etiquetaInyectora(ciclo.inyectora)} />
        <Dato label="Partida" valor={ciclo.partidaNumero != null ? `N° ${ciclo.partidaNumero}` : "—"} />
        <Dato label="Operario" valor={ciclo.operarioNombre ?? "—"} />
        <Dato label="Golpes de inicio" valor={ciclo.golpesInicio != null ? fmtNumero(ciclo.golpesInicio, 0) : "—"} />
        <Dato label="Piezas por golpe" valor={ciclo.piezasPorGolpe != null ? fmtNumero(ciclo.piezasPorGolpe, 0) : "—"} />
        <Dato label="Inyección deseada" valor={ciclo.cantidadDeseada != null ? `${fmtNumero(ciclo.cantidadDeseada, 0)} piezas` : "—"} />
        <Dato
          label="Master configurado"
          valor={dosificacion ? `${fmtNumero(dosificacion.gPorKgMp, 4)} g/kg · ${ciclo.productoColorNombre ?? "—"}${dosificacion.origen === "excepcion" ? " (propio del color)" : ""}` : "sin dosificación"}
        />
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Material del ciclo</h2>
          {abierto && puedeOperar && (
            <Link href={`/materia-prima/retiro?ciclo=${ciclo.id}`} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">
              Retirar materia prima a pie de máquina →
            </Link>
          )}
        </div>
        {retiros.length === 0 && legado.length === 0 && (
          <p className="text-foreground-muted">
            {abierto ? "Todavía no se retiró material del depósito para este ciclo." : "No se registró materia prima para este ciclo."}
          </p>
        )}
        {retiros.map((r) => (
          <div key={r.id} className="rounded-md border border-border p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Link href={`/materia-prima/retiros/${r.id}`} className="font-medium text-accent hover:underline">
                Retiro {r.numero}
              </Link>
              <span className={`badge-estado ${r.estado === "ABIERTO" ? "badge-bajo" : "badge-ok"}`}>{r.estado === "ABIERTO" ? "abierto" : "cerrado"}</span>
              {r.cicloId !== ciclo.id && <span className="text-xs text-foreground-muted">retirado para el ciclo #{r.cicloId} (misma partida)</span>}
            </div>
            <OperacionesRetiro
              r={r}
              ciclos={ciclosCarga}
              codigosSobrante={sobrantes.map((s) => ({ id: s.id, codigo: s.codigo, nombre: s.nombre }))}
              puedeOperar={puedeOperar}
              puedeCorregir={puedeCorregir}
            />
          </div>
        ))}
        {legado.length > 0 && (
          <div>
            <div className="text-xs text-foreground-muted">Retiros anteriores al circuito de pie de máquina (se consideran cargados):</div>
            <ul className="space-y-1">
              {legado.map((r) => (
                <li key={r.id}>
                  {r.materiaPrimaNombre} · {fmtNumero(r.cantidad, 3)} kg ·{" "}
                  {r.loteCodigo ? (
                    <Link href={`/trazabilidad?tipo=lote&valor=${r.loteCodigo}`} className="font-mono text-accent hover:underline">
                      {r.productoNumero ? codigoDeUso(r.loteCodigo, r.productoNumero) : r.loteCodigo}
                    </Link>
                  ) : (
                    <span className="text-foreground-muted">stock sin lote</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {control && (
        <section className="rounded-lg border border-border bg-surface p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Control de material</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <Dato label="Retirado" valor={`${fmtNumero(control.retirado, 3)} kg`} />
            <Dato label="Cargado en tolva (virgen)" valor={`${fmtNumero(control.cargadoVirgen, 3)} kg`} />
            <Dato label="Master incorporado" valor={`${fmtNumero(control.masterIncorporado, 3)} kg`} />
            <Dato label="Devuelto sin mezclar" valor={`${fmtNumero(control.devuelto, 3)} kg`} />
            <Dato label="Sobrante mezclado" valor={`${fmtNumero(control.sobrante, 3)} kg`} />
            <Dato label="Piezas teóricas" valor={control.piezasTeoricas != null ? fmtNumero(control.piezasTeoricas, 0) : "falta dato"} />
            <Dato label="Piezas buenas / descarte" valor={`${control.piezasBuenas != null ? fmtNumero(control.piezasBuenas, 0) : "—"} / ${control.piezasDescartadas != null ? fmtNumero(control.piezasDescartadas, 0) : "—"}`} />
            <Dato
              label="Diferencia a justificar"
              valor={control.diferenciaKg != null ? `${fmtNumero(control.diferenciaKg, 3)} kg` : control.cerrado ? "falta dato" : "al cerrar el día"}
            />
          </div>
          <p className="mt-2 text-xs text-foreground-muted">
            Teóricas = (cargado − sobrante) ÷ peso por pieza{control.kgPorPieza ? ` (${fmtNumero(control.kgPorPieza, 4)} kg)` : ""}. Diferencia = cargado −
            sobrante − producidas × peso − colada/rebarba/scrap ({fmtNumero(control.residuosKg, 3)} kg).
            {control.faltaDato && <span className="text-[var(--estado-bajo-fg)]"> {control.faltaDato}</span>}
            {control.legado > 0 && " Incluye retiros anteriores al circuito de pie de máquina."}
          </p>
        </section>
      )}

      {cajas.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4 text-sm">
          <h2 className="mb-2 text-sm font-semibold text-foreground-muted">Cajas generadas ({cajas.length})</h2>
          <div className="flex flex-wrap gap-2">
            {cajas.map((c) => (
              <Link key={c.id} href={`/trazabilidad?tipo=caja&valor=${c.codigo}`} className="rounded bg-surface-muted px-2 py-1 font-mono text-xs hover:text-accent">
                {c.codigo} · {c.cantidad} u. · {c.estado === "EN_STOCK" ? "en stock" : c.estado === "ARMADA" ? "armada" : c.estado === "DESPACHADA" ? "despachada" : "baja"}
              </Link>
            ))}
          </div>
        </div>
      )}

      {ciclo.pedidos.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-foreground-muted">Planificación: pedidos que busca cubrir</h2>
          <p className="mb-2 text-xs text-foreground-muted">Referencia del inicio del día; no reserva stock.</p>
          <ul className="space-y-1 text-sm">
            {ciclo.pedidos.map((p) => (
              <li key={p.pedidoId} className="flex justify-between">
                <Link href={`/pedidos/${p.pedidoId}`} className="text-foreground-muted hover:text-accent">
                  Pedido #{p.pedidoId} · {p.clienteNombre}
                </Link>
                <span className="text-foreground">{fmtNumero(p.cantidadAsignada, 0)} planificadas</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ciclo.fechaFin ? (
        <>
          <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-4">
            <Dato label="Fin" valor={fmtDia(ciclo.fechaFin)} />
            <Dato label="Golpes de fin" valor={ciclo.golpesFin != null ? fmtNumero(ciclo.golpesFin, 0) : "—"} />
            <Dato label="Piezas producidas" valor={ciclo.piezasProducidas != null ? fmtNumero(ciclo.piezasProducidas, 0) : "—"} />
            <Dato label="Piezas descartadas" valor={ciclo.piezasDescartadas != null ? fmtNumero(ciclo.piezasDescartadas, 0) : "—"} />
            <Dato label="Piezas que entraron a stock" valor={ciclo.piezasEntregadas != null ? fmtNumero(ciclo.piezasEntregadas, 0) : "—"} />
            <Dato label="Colada (kg)" valor={ciclo.coladaKg ?? "—"} />
            <Dato label="Rebarba (kg)" valor={ciclo.rebarbaKg ?? "—"} />
            <Dato label="Scrap (kg)" valor={ciclo.scrapKg ?? "—"} />
          </div>
          {puedeCorregir && (
            <CorreccionCierre
              cicloId={ciclo.id}
              actual={{
                golpesFin: ciclo.golpesFin,
                piezasDescartadas: ciclo.piezasDescartadas,
                piezasEntregadas: ciclo.piezasEntregadas,
                coladaKg: ciclo.coladaKg,
                rebarbaKg: ciclo.rebarbaKg,
                scrapKg: ciclo.scrapKg,
              }}
            />
          )}
        </>
      ) : (
        <FormularioCierre
          cicloId={ciclo.id}
          golpesInicio={ciclo.golpesInicio}
          piezasPorGolpe={ciclo.piezasPorGolpe}
          pendientePedidos={resumen?.pendientePedidos ?? 0}
          stockActual={resumen?.stock ?? 0}
          minimo={resumen?.minimo ?? null}
          deseada={ciclo.cantidadDeseada}
        />
      )}
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div className="text-xs text-foreground-muted">{label}</div>
      <div className="font-medium text-foreground">{valor}</div>
    </div>
  );
}
