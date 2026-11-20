import Link from "next/link";
import { etiquetasDe, type EtiquetaCaja } from "@/lib/data/produccion";
import { etiquetaTurno } from "@/lib/data/planificacion";
import { anchosCode128 } from "@/lib/code128";
import { fmtFecha, fmtNumero } from "@/lib/format";
import { BotonImprimir } from "./imprimir";

/**
 * Etiquetas de cajas (reunión 10/11/2026): una por caja, con el formato de la
 * etiqueta nueva — código y nombre del producto, fecha, partida, color en
 * grande, cantidad y código de barras (001B-6000172-00022). Se imprimen al
 * terminar la producción (reunión 20/11/2026: ya no al cerrar cada turno) o
 * desde el menú «Etiquetas». Imprimir no mueve el stock: las cajas entraron al
 * cerrar, así que una reimpresión no suma cajas.
 *
 * Tamaño: 100 × 60 mm, una por hoja (la impresora de planta todavía no está
 * definida; se ajusta acá).
 */
export default async function EtiquetasPage({ searchParams }: { searchParams: Promise<{ turno?: string; ciclo?: string; ultimas?: string; cajas?: string; volver?: string; fin?: string }> }) {
  const sp = await searchParams;
  const etiquetas = await etiquetasDe({
    turnoId: Number(sp.turno) || undefined,
    cicloId: Number(sp.ciclo) || undefined,
    ultimas: sp.ultimas === "1",
    cajaIds: sp.cajas ? sp.cajas.split(",").map(Number).filter(Boolean) : undefined,
  });
  // Se vuelve a la pantalla de la que se vino: el menú Etiquetas, la producción o la del operario.
  const volver = sp.volver === "menu" ? "/etiquetas" : sp.volver?.startsWith("produccion-") ? `/produccion/${Number(sp.volver.slice(11))}` : "/taller";
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <style>{`
        @page { size: 100mm 60mm; margin: 0; }
        @media print {
          body * { visibility: hidden !important; }
          .zona-etiquetas, .zona-etiquetas * { visibility: visible !important; }
          .zona-etiquetas { position: absolute; inset: 0; }
          .etiqueta { width: 100mm; height: 60mm; border: 0 !important; margin: 0 !important; box-shadow: none !important; page-break-after: always; }
        }
      `}</style>
      {sp.fin === "1" && (
        <div className="aviso aviso-ok print:hidden">
          <b>Producción terminada.</b> Imprimí las etiquetas y pegá una en cada caja.
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h1 className="text-xl">Etiquetas de cajas</h1>
          <p className="text-sm text-foreground-muted">
            {etiquetas.length === 0 ? "No hay cajas para imprimir." : `${etiquetas.length} etiqueta${etiquetas.length === 1 ? "" : "s"}: una por caja.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={volver} className="btn btn-outline">
            Volver
          </Link>
          {etiquetas.length > 0 && <BotonImprimir />}
        </div>
      </div>
      <div className="zona-etiquetas space-y-3">
        {etiquetas.map((e) => (
          <Etiqueta key={e.id} e={e} />
        ))}
      </div>
    </div>
  );
}

function Etiqueta({ e }: { e: EtiquetaCaja }) {
  return (
    <article className="etiqueta flex flex-col justify-between overflow-hidden rounded-lg border border-border bg-white p-[3mm] text-black shadow-sm" style={{ width: "100mm", height: "60mm" }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13pt] font-bold leading-tight">{e.productoCodigo.split("-")[0]}</div>
          <div className="truncate text-[8pt] leading-tight">{e.productoDescripcion}</div>
        </div>
        <div className="text-right text-[8pt] leading-tight">
          <div>{fmtFecha(e.fecha)}</div>
          <div>Partida N° {e.partida}</div>
          {e.turno && (
            <div>
              {etiquetaTurno(e.turno)}
              {e.operario ? ` · ${e.operario}` : ""}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="text-[22pt] font-black uppercase leading-none">{e.colorNombre ?? ""}</div>
        <div className="text-right leading-none">
          <div className="text-[18pt] font-bold">{fmtNumero(e.cantidad, 0)}</div>
          <div className="text-[7pt]">piezas</div>
        </div>
      </div>
      <CodigoDeBarras texto={e.codigo} />
    </article>
  );
}

/** Code 128 en SVG, con zona libre a los costados para que lo lea el lector. */
function CodigoDeBarras({ texto }: { texto: string }) {
  const anchos = anchosCode128(texto);
  const libre = 10;
  const total = anchos.reduce((t, n) => t + n, 0) + libre * 2;
  let x = libre;
  const barras: { x: number; w: number }[] = [];
  anchos.forEach((w, i) => {
    if (i % 2 === 0) barras.push({ x, w });
    x += w;
  });
  return (
    <div>
      <svg viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" className="block h-[13mm] w-full" role="img" aria-label={`Código de barras ${texto}`}>
        <rect width={total} height={40} fill="#fff" />
        {barras.map((b, i) => (
          <rect key={i} x={b.x} y={0} width={b.w} height={40} fill="#000" />
        ))}
      </svg>
      <div className="text-center font-mono text-[9pt] tracking-wider">{texto}</div>
    </div>
  );
}
