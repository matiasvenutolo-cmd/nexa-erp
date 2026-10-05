import Link from "next/link";
import { etiquetarAuditoria, listarAuditoria } from "@/lib/data/auditoria";
import { fmtFechaHora } from "@/lib/format";
import { TD, TH, exigirSeccion } from "../comunes";

const FILTROS = [
  { v: undefined, label: "Todo" },
  { v: "producto", label: "Stock productos" },
  { v: "materia_prima", label: "Stock MP" },
  { v: "dosificacion_master", label: "Master" },
  { v: "color", label: "Colores" },
  { v: "parametro", label: "Parámetros" },
  { v: "pedido", label: "Prioridad de pedidos" },
  { v: "usuario", label: "Usuarios" },
];

export default async function AdminHistorialPage({ searchParams }: { searchParams: Promise<{ entidad?: string }> }) {
  await exigirSeccion("/admin/historial");
  const sp = await searchParams;
  const filas = await listarAuditoria({ entidad: sp.entidad, limite: 300 });
  const etiquetas = await etiquetarAuditoria(filas);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTROS.map((f) => (
          <Link
            key={f.label}
            href={f.v ? `/admin/historial?entidad=${f.v}` : "/admin/historial"}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              sp.entidad === f.v ? "bg-accent text-accent-foreground" : "bg-surface-muted text-foreground-muted hover:text-foreground"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                <th className={TH}>Fecha</th>
                <th className={TH}>Quién</th>
                <th className={TH}>Qué</th>
                <th className={TH}>Campo</th>
                <th className={TH}>Antes</th>
                <th className={TH}>Después</th>
                <th className={TH}>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className="border-b border-border last:border-0">
                  <td className={`${TD} whitespace-nowrap text-foreground-muted`}>{fmtFechaHora(f.creadoEn)}</td>
                  <td className={TD}>{f.usuarioNombre}</td>
                  <td className={TD}>{etiquetas.get(f.id)}</td>
                  <td className={`${TD} text-foreground-muted`}>{f.campo}</td>
                  <td className={`${TD} text-foreground-muted`}>{f.valorAnterior ?? "—"}</td>
                  <td className={`${TD} font-medium`}>{f.valorNuevo ?? "—"}</td>
                  <td className={`${TD} text-foreground-muted`}>{f.motivo ?? ""}</td>
                </tr>
              ))}
              {filas.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-foreground-muted">
                    Sin cambios registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
