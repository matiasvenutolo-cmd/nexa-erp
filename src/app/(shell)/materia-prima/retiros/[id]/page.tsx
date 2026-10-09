import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ciclosAbiertos, codigosDeSobrante, obtenerRetirosMaquina } from "@/lib/data/maquina";
import { getUsuarioActual } from "@/lib/session";
import { puedeCorregirProduccionMp, puedeRetirarMateriaPrima, puedeVerMateriaPrima } from "@/lib/auth/permisos";
import { fmtFecha, fmtFechaHora, fmtNumero } from "@/lib/format";
import { etiquetaInyectora } from "@/lib/inyectoras";
import { OperacionesRetiro } from "@/components/operaciones-retiro";

export default async function RetiroDetallePage({ params }: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeVerMateriaPrima(usuario.rol) && !puedeCorregirProduccionMp(usuario.rol)) redirect("/tablero");
  const { id } = await params;
  const [r] = await obtenerRetirosMaquina({ ids: [Number(id)] });
  if (!r) notFound();
  const [ciclos, sobrantes] = await Promise.all([ciclosAbiertos(), codigosDeSobrante()]);
  const delaInyectora = ciclos
    .filter((c) => c.inyectora.replace(/inyectora/i, "").trim() === r.inyectora)
    .map((c) => ({ id: c.id, etiqueta: `Ciclo #${c.id} · ${fmtFecha(c.fechaInicio)} · ${c.productoCodigo ?? "—"} · partida N° ${c.partidaNumero ?? "—"}` }));

  return (
    <div className="max-w-5xl space-y-5">
      <div>
        <Link href="/materia-prima" className="text-sm text-foreground-muted hover:text-foreground">
          ← Materia prima
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-brand-azul-oscuro">Retiro {r.numero}</h1>
          <span className={`badge-estado ${r.estado === "ABIERTO" ? "badge-bajo" : "badge-ok"}`}>
            {r.estado === "ABIERTO" ? "Abierto — material a pie de máquina" : "Cerrado y conciliado"}
          </span>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-3">
        <Dato label="Inyectora" valor={etiquetaInyectora(r.inyectora)} />
        <Dato label="Fecha y hora" valor={fmtFechaHora(r.fechaHora)} />
        <Dato label="Operario responsable" valor={r.operarioNombre ?? "—"} />
        <div>
          <div className="text-xs text-foreground-muted">Ciclo</div>
          <div className="font-medium">
            {r.cicloId ? (
              <Link href={`/produccion/${r.cicloId}`} className="text-accent hover:underline">
                #{r.cicloId}
              </Link>
            ) : (
              "sin ciclo"
            )}
            {r.partidaNumero != null && ` · partida N° ${r.partidaNumero}`}
          </div>
        </div>
        <Dato label="Producto previsto" valor={r.productoCodigo ?? "—"} />
        <Dato
          label="Piezas previstas"
          valor={r.piezasPrevistas != null ? `${fmtNumero(r.piezasPrevistas, 0)}${r.productoKgPorUnidad ? ` (≈ ${fmtNumero(r.piezasPrevistas * r.productoKgPorUnidad, 1)} kg)` : ""}` : "—"}
        />
        {r.observaciones && (
          <div className="sm:col-span-3">
            <Dato label="Observaciones" valor={r.observaciones} />
          </div>
        )}
        {r.cerradoEn && <Dato label="Cerrado" valor={fmtFechaHora(r.cerradoEn)} />}
      </div>

      <section className="rounded-lg border border-border bg-surface p-4">
        <OperacionesRetiro
          r={r}
          ciclos={delaInyectora}
          codigosSobrante={sobrantes.map((s) => ({ id: s.id, codigo: s.codigo, nombre: s.nombre }))}
          puedeOperar={puedeRetirarMateriaPrima(usuario.rol)}
          puedeCorregir={puedeCorregirProduccionMp(usuario.rol)}
        />
      </section>
    </div>
  );
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div className="text-xs text-foreground-muted">{label}</div>
      <div className="font-medium">{valor}</div>
    </div>
  );
}
