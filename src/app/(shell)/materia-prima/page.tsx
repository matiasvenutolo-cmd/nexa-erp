import Link from "next/link";
import { redirect } from "next/navigation";
import { listarMinMaxMateriaPrima } from "@/lib/data/stock-config";
import { listarLotes, listarRetiros } from "@/lib/data/materia-prima";
import { getUsuarioActual } from "@/lib/session";
import { puedeIngresarMateriaPrima, puedeRetirarMateriaPrima, puedeVerMateriaPrima } from "@/lib/auth/permisos";
import { Semaforo } from "@/components/semaforo";
import { fmtFecha, fmtNumero } from "@/lib/format";

export default async function MateriaPrimaPage() {
  const usuario = await getUsuarioActual();
  if (!puedeVerMateriaPrima(usuario.rol)) redirect("/tablero");
  const [stock, lotes, retiros] = await Promise.all([listarMinMaxMateriaPrima(), listarLotes({ soloConSaldo: true }), listarRetiros({ limite: 20 })]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-brand-azul-oscuro">Materia prima</h1>
        <div className="flex gap-2">
          {puedeIngresarMateriaPrima(usuario.rol) && (
            <Link href="/materia-prima/ingreso" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">
              + Ingreso con certificado y lote
            </Link>
          )}
          {puedeRetirarMateriaPrima(usuario.rol) && (
            <Link href="/materia-prima/retiro" className="rounded-md bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground">
              Retiro a máquina
            </Link>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">Lotes con saldo</h2>
        {lotes.length === 0 ? (
          <p className="text-sm text-foreground-muted">Todavía no hay lotes ingresados. El stock importado del Excel no tiene lote.</p>
        ) : (
          <Tabla
            cabecera={["Lote", "Materia prima", "Certificado", "Ingreso", "Disponible (kg)"]}
            filas={lotes.map((l) => [
              <Link key="l" href={`/trazabilidad?tipo=lote&valor=${l.codigoBarra}`} className="font-mono text-xs text-accent hover:underline">
                {l.codigoBarra}
              </Link>,
              l.materiaPrimaNombre,
              l.certificadoNumero ? `N° ${l.certificadoNumero} · ${l.proveedor}` : "—",
              fmtFecha(l.fechaIngreso),
              fmtNumero(l.disponible, 3),
            ])}
          />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">Stock</h2>
        <Tabla
          cabecera={["Código", "Materia prima", "Tipo", "Stock (kg)", "Mínimo", "Máximo", "Estado"]}
          filas={stock.map((m) => [
            m.codigo,
            m.descripcion,
            m.grupo,
            fmtNumero(m.stock, 3),
            fmtNumero(m.minimo, 3),
            fmtNumero(m.maximo, 3),
            <Semaforo key="s" estado={m.estado} />,
          ])}
        />
        <p className="mt-1 text-xs text-foreground-muted">Mínimos y máximos: Panel Admin → Stock → Materia prima.</p>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-foreground-muted">Últimos retiros a máquina</h2>
        {retiros.length === 0 ? (
          <p className="text-sm text-foreground-muted">Sin retiros registrados.</p>
        ) : (
          <Tabla
            cabecera={["Fecha", "Materia prima", "Kg", "Lote", "Ciclo", "Retiró"]}
            filas={retiros.map((r) => [
              fmtFecha(r.fecha),
              r.materiaPrimaNombre,
              fmtNumero(r.cantidad, 3),
              r.loteCodigo ? <span key="l" className="font-mono text-xs">{r.loteCodigo}</span> : "sin lote",
              r.cicloId ? (
                <Link key="c" href={`/produccion/${r.cicloId}`} className="text-accent hover:underline">
                  #{r.cicloId}
                </Link>
              ) : (
                "—"
              ),
              r.retiraNombre,
            ])}
          />
        )}
      </section>
    </div>
  );
}

function Tabla({ cabecera, filas }: { cabecera: string[]; filas: React.ReactNode[][] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
              {cabecera.map((c) => (
                <th key={c} className="px-4 py-2.5">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={i} className="border-b border-border last:border-0">
                {f.map((c, j) => (
                  <td key={j} className="px-4 py-2.5">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
