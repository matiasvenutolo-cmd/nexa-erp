import { notFound } from "next/navigation";
import { obtenerCiclo } from "@/lib/data/produccion";
import { resolverDosificacion } from "@/lib/data/dosificacion";
import { fmtNumero, fmtFecha } from "@/lib/format";
import { FormularioCierre } from "./formulario-cierre";

export default async function CicloPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ciclo = await obtenerCiclo(Number(id));
  if (!ciclo) notFound();
  const dosificacion = ciclo.productoFamilia
    ? await resolverDosificacion(ciclo.productoFamilia, ciclo.productoColorId)
    : null;
  const kgMp =
    ciclo.piezasProducidas != null && ciclo.productoKgPorUnidad != null
      ? ciclo.piezasProducidas * Number(ciclo.productoKgPorUnidad)
      : null;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold text-brand-azul-oscuro">
        Ciclo #{ciclo.id} — {ciclo.productoCodigo} · {ciclo.productoDescripcion}
      </h1>

      <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-3">
        <Dato label="Inicio" valor={fmtFecha(ciclo.fechaInicio)} />
        <Dato label="Inyectora" valor={ciclo.inyectora} />
        <Dato label="Partida" valor={ciclo.partidaNumero != null ? `N° ${ciclo.partidaNumero}` : "—"} />
        <Dato label="Operario" valor={ciclo.operarioNombre ?? "—"} />
        <Dato label="Golpes de inicio" valor={ciclo.golpesInicio != null ? fmtNumero(ciclo.golpesInicio, 0) : "—"} />
        <Dato label="Piezas por golpe" valor={ciclo.piezasPorGolpe != null ? fmtNumero(ciclo.piezasPorGolpe, 0) : "—"} />
      </div>

      <div className="rounded-lg border border-border bg-surface p-4 text-sm">
        <h2 className="mb-2 text-sm font-semibold text-foreground-muted">Master</h2>
        {dosificacion ? (
          <div className="space-y-1">
            <p>
              <span className="font-medium">{fmtNumero(dosificacion.kgPorKgMp, 4)} kg de master por kg</span>
              {dosificacion.materiaPrimaBaseNombre ? ` de ${dosificacion.materiaPrimaBaseNombre}` : " de materia prima"}{" "}
              <span className="text-foreground-muted">
                ({fmtNumero(dosificacion.kgPorKgMp * 1000, 1)} g por kg ·{" "}
                {dosificacion.origen === "excepcion" ? `valor propio del color ${dosificacion.colorNombre}` : "valor general del tipo de producto"})
              </span>
            </p>
            {kgMp != null && (
              <p className="text-foreground-muted">
                Para {fmtNumero(ciclo.piezasProducidas, 0)} piezas (≈ {fmtNumero(kgMp, 1)} kg de materia prima con el peso
                teórico por pieza): ≈ {fmtNumero(kgMp * dosificacion.kgPorKgMp, 2)} kg de master.
              </p>
            )}
          </div>
        ) : (
          <p className="text-foreground-muted">
            Sin dosificación cargada para este tipo de producto — se configura en Panel Admin → Master.
          </p>
        )}
      </div>

      {ciclo.pedidos.length > 0 && (
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold text-foreground-muted">Pedidos que cubre</h2>
          <ul className="space-y-1 text-sm">
            {ciclo.pedidos.map((p) => (
              <li key={p.pedidoId} className="flex justify-between">
                <span className="text-foreground-muted">
                  Pedido #{p.pedidoId} · {p.clienteNombre}
                </span>
                <span className="text-foreground">{fmtNumero(p.cantidadAsignada, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ciclo.fechaFin ? (
        <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-3">
          <Dato label="Fin" valor={fmtFecha(ciclo.fechaFin)} />
          <Dato label="Golpes de fin" valor={ciclo.golpesFin != null ? fmtNumero(ciclo.golpesFin, 0) : "—"} />
          <Dato label="Piezas producidas" valor={ciclo.piezasProducidas != null ? fmtNumero(ciclo.piezasProducidas, 0) : "—"} />
          <Dato label="Piezas descartadas" valor={ciclo.piezasDescartadas != null ? fmtNumero(ciclo.piezasDescartadas, 0) : "—"} />
          <Dato label="Piezas a stock" valor={ciclo.piezasEntregadas != null ? fmtNumero(ciclo.piezasEntregadas, 0) : "—"} />
          <Dato label="Colada (kg)" valor={ciclo.coladaKg ?? "—"} />
          <Dato label="Rebarba (kg)" valor={ciclo.rebarbaKg ?? "—"} />
          <Dato label="Scrap (kg)" valor={ciclo.scrapKg ?? "—"} />
        </div>
      ) : (
        <FormularioCierre
          cicloId={ciclo.id}
          golpesInicio={ciclo.golpesInicio}
          piezasPorGolpe={ciclo.piezasPorGolpe}
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
