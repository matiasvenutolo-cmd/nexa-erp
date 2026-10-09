import Link from "next/link";
import { redirect } from "next/navigation";
import { listarMinMaxMateriaPrima } from "@/lib/data/stock-config";
import { listarLotes, listarRetiros } from "@/lib/data/materia-prima";
import { numeroRetiro, pieDeMaquina } from "@/lib/data/maquina";
import { puedeCorregirProduccionMp } from "@/lib/auth/permisos";
import { CorregirLote } from "./corregir-lote";
import { getUsuarioActual } from "@/lib/session";
import { puedeIngresarMateriaPrima, puedeRetirarMateriaPrima, puedeVerMateriaPrima } from "@/lib/auth/permisos";
import { Semaforo } from "@/components/semaforo";
import { fmtFecha, fmtNumero } from "@/lib/format";
import { etiquetaInyectora } from "@/lib/inyectoras";

const TIPOS = [
  { valor: undefined, label: "Todas" },
  { valor: "VIRGEN", label: "Virgen" },
  { valor: "MASTER", label: "Master" },
  { valor: "MOLIENDA", label: "Molienda" },
  { valor: "SOBRANTE", label: "Sobrante" },
  { valor: "MUESTRA", label: "Muestra" },
];

/**
 * Orden de la pantalla: primero lo operativo de fábrica (qué salió a máquina),
 * después el stock por tipo y al final los lotes con su certificado.
 * "Lote de MP" es el lote del proveedor ingresado con certificado (código de
 * 27 dígitos); no es la partida NEXA, que agrupa la producción.
 */
export default async function MateriaPrimaPage({ searchParams }: { searchParams: Promise<{ tipo?: string; texto?: string; alertas?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeVerMateriaPrima(usuario.rol)) redirect("/tablero");
  const sp = await searchParams;
  const [stock, lotes, retiros, pie] = await Promise.all([
    listarMinMaxMateriaPrima(),
    listarLotes({ soloConSaldo: true }),
    listarRetiros({ limite: 30 }),
    pieDeMaquina(),
  ]);
  const corrige = puedeCorregirProduccionMp(usuario.rol);

  const tipo = TIPOS.some((t) => t.valor === sp.tipo) ? sp.tipo : undefined;
  const texto = sp.texto?.trim().toLowerCase();
  const soloAlertas = sp.alertas === "1";
  const stockVisible = stock.filter(
    (m) =>
      (!tipo || m.grupo === tipo) &&
      (!texto || `${m.codigo} ${m.descripcion}`.toLowerCase().includes(texto)) &&
      (!soloAlertas || m.estado === "critico" || m.estado === "bajo"),
  );
  const query = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tipo: sp.tipo, texto: sp.texto, alertas: sp.alertas, ...over })) if (v) p.set(k, v);
    const qs = p.toString();
    return `/materia-prima${qs ? `?${qs}` : ""}#stock`;
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-brand-azul-oscuro">Materia prima</h1>
        <div className="flex gap-2">
          {puedeRetirarMateriaPrima(usuario.rol) && (
            <Link href="/materia-prima/retiro" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">
              Retiro a máquina
            </Link>
          )}
          {puedeIngresarMateriaPrima(usuario.rol) && (
            <Link href="/materia-prima/ingreso" className="rounded-md bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground">
              + Ingreso con certificado y lote
            </Link>
          )}
        </div>
      </div>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">Material a pie de máquina (retiros abiertos)</h2>
        <p className="text-xs text-foreground-muted">
          Retirado del depósito y todavía no cargado, devuelto ni justificado. Queda registrado entre turnos hasta cerrar el retiro.
        </p>
        {pie.length === 0 ? (
          <p className="text-sm text-foreground-muted">No hay retiros abiertos.</p>
        ) : (
          <Tabla
            cabecera={["Retiro", "Inyectora", "Ciclo · partida", "Retirado", "Cargado en tolva", "Devuelto", "A pie de máquina"]}
            filas={pie.map((r) => [
              <Link key="r" href={`/materia-prima/retiros/${r.id}`} className="font-medium text-accent hover:underline">
                {r.numero}
              </Link>,
              etiquetaInyectora(r.inyectora),
              r.cicloId ? `#${r.cicloId}${r.partidaNumero != null ? ` · N° ${r.partidaNumero}` : ""}` : "sin ciclo",
              `${fmtNumero(r.totales.retirado, 3)} kg`,
              `${fmtNumero(r.totales.cargado, 3)} kg`,
              `${fmtNumero(r.totales.devuelto, 3)} kg`,
              <span key="p" className={r.totales.pie > 0 ? "font-semibold text-[var(--estado-bajo-fg)]" : ""}>
                {fmtNumero(r.totales.pie, 3)} kg
              </span>,
            ])}
          />
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">Movimientos a máquina (retiros del depósito)</h2>
        <p className="text-xs text-foreground-muted">Últimos 30. Cada retiro con ciclo queda vinculado a la partida NEXA que se produjo.</p>
        {retiros.length === 0 ? (
          <p className="text-sm text-foreground-muted">Sin retiros registrados.</p>
        ) : (
          <Tabla
            cabecera={["Fecha", "Retiro", "Materia prima", "Kg", "Lote de MP", "Ciclo · producto", "Partida NEXA", "Inyectora", "Retiró"]}
            filas={retiros.map((r) => [
              fmtFecha(r.fecha),
              r.retiroMaquinaId ? (
                <Link key="rm" href={`/materia-prima/retiros/${r.retiroMaquinaId}`} className="text-accent hover:underline">
                  {numeroRetiro(r.retiroMaquinaId)}
                  {r.anulado ? " (anulado)" : ""}
                </Link>
              ) : (
                <span key="rm" className="text-xs text-foreground-muted">anterior al circuito</span>
              ),
              r.materiaPrimaNombre,
              fmtNumero(r.cantidad, 3),
              r.loteCodigo ? (
                <Link key="l" href={`/trazabilidad?tipo=lote&valor=${r.loteCodigo}`} className="font-mono text-xs text-accent hover:underline">
                  {r.loteCodigo}
                </Link>
              ) : (
                <span key="l" className="text-foreground-muted">sin lote</span>
              ),
              r.cicloId ? (
                <Link key="c" href={`/produccion/${r.cicloId}`} className="text-accent hover:underline">
                  #{r.cicloId} · {r.productoCodigo ?? "—"}
                </Link>
              ) : (
                "—"
              ),
              r.partidaNumero != null ? (
                <Link key="p" href={`/trazabilidad?tipo=partida&valor=${r.partidaNumero}`} className="text-accent hover:underline">
                  N° {r.partidaNumero}
                </Link>
              ) : (
                "—"
              ),
              r.inyectora ? etiquetaInyectora(r.inyectora) : "—",
              r.retiraNombre,
            ])}
          />
        )}
      </section>

      <section id="stock" className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">Stock de materia prima</h2>
        <div className="flex flex-wrap items-center gap-2">
          {TIPOS.map((t) => (
            <Link
              key={t.label}
              href={query({ tipo: t.valor })}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                tipo === t.valor ? "bg-accent text-accent-foreground" : "bg-surface-muted text-foreground-muted hover:text-foreground"
              }`}
            >
              {t.label}
            </Link>
          ))}
          <Link
            href={query({ alertas: soloAlertas ? undefined : "1" })}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              soloAlertas ? "bg-accent text-accent-foreground" : "bg-surface-muted text-foreground-muted hover:text-foreground"
            }`}
          >
            Solo alertas
          </Link>
          <form action="/materia-prima" className="ml-auto">
            {tipo && <input type="hidden" name="tipo" value={tipo} />}
            {soloAlertas && <input type="hidden" name="alertas" value="1" />}
            <input type="search" name="texto" defaultValue={sp.texto ?? ""} placeholder="Buscar materia prima…" className="input w-56" />
          </form>
        </div>
        <Tabla
          cabecera={["Código", "Materia prima", "Tipo", "Stock (kg)", "Mínimo", "Máximo", "Estado"]}
          filas={stockVisible.map((m) => [
            m.codigo,
            m.descripcion,
            m.grupo,
            fmtNumero(m.stock, 3),
            fmtNumero(m.minimo, 3),
            fmtNumero(m.maximo, 3),
            <Semaforo key="s" estado={m.estado} />,
          ])}
        />
        <p className="text-xs text-foreground-muted">
          {stockVisible.length} de {stock.length}. Mínimos y máximos: Panel Admin → Stock → Materia prima.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold text-foreground">Lotes de MP con saldo</h2>
        <p className="text-xs text-foreground-muted">
          Lote de MP = el lote del proveedor ingresado con su certificado de calidad. El código de barras tiene 27 dígitos: 3 de
          producto (000 al ingresar), 4 de materia prima, 8 de proveedor/certificado y 12 del N° de lote del proveedor.
        </p>
        {lotes.length === 0 ? (
          <p className="text-sm text-foreground-muted">Todavía no hay lotes ingresados. El stock importado del Excel no tiene lote.</p>
        ) : (
          <Tabla
            cabecera={["Lote de MP (código)", "N° de lote del proveedor", "Materia prima", "Certificado", "Ingreso", "Disponible (kg)", ...(corrige ? [""] : [])]}
            filas={lotes.map((l) => [
              <Link key="l" href={`/trazabilidad?tipo=lote&valor=${l.codigoBarra}`} className="font-mono text-xs text-accent hover:underline">
                {l.codigoBarra}
              </Link>,
              <span key="n" className="font-mono text-xs">
                {l.numeroLote}
              </span>,
              l.materiaPrimaNombre,
              l.certificadoNumero ? `N° ${l.certificadoNumero} · ${l.proveedor}` : "—",
              fmtFecha(l.fechaIngreso),
              fmtNumero(l.disponible, 3),
              ...(corrige ? [<CorregirLote key="c" loteId={l.id} ingresado={Number(l.ingresado)} />] : []),
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
            {filas.length === 0 && (
              <tr>
                <td colSpan={cabecera.length} className="px-4 py-6 text-center text-foreground-muted">
                  Sin resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
