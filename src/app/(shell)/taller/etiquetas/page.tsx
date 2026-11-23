import Link from "next/link";
import { etiquetasDe, type EtiquetaCaja } from "@/lib/data/produccion";
import { matrizDe } from "@/lib/data/planificacion";
import { anchosCode128 } from "@/lib/code128";
import { fmtFecha } from "@/lib/format";
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

/** Datos de contacto que lleva la etiqueta de NEXA (foto de la etiqueta real, 23/11/2026). */
const CONTACTO = ["Nexa soluciones", "WhatsApp: + 54 112855-3444", "cotizame.nexa@gmail.com", "www.nexasoluciones.com.ar"];

/**
 * Formato de la etiqueta real de NEXA (cambios del 23/11/2026): logo y
 * contacto a la izquierda; código y nombre del producto, fecha, partida,
 * color y cantidad a la derecha; código de barras abajo. Sin turno ni
 * operario.
 */
function Etiqueta({ e }: { e: EtiquetaCaja }) {
  const codigo = e.productoCodigo.split("-")[0];
  return (
    <article className="etiqueta relative overflow-hidden rounded-lg border border-border bg-white text-black shadow-sm" style={{ width: "100mm", height: "60mm", padding: "3mm 3.5mm" }}>
      <div className="flex h-full flex-col">
        <div className="flex flex-1 justify-between gap-2">
          <div className="flex w-[52%] flex-col justify-end pb-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/nexa-logo.png" alt="NEXA Soluciones" style={{ width: "44mm", margin: "-3mm 0 -2mm -2mm" }} />
            <div className="leading-[1.25]" style={{ fontSize: "5.6pt" }}>
              {CONTACTO.map((l) => (
                <div key={l}>{l}</div>
              ))}
            </div>
          </div>
          <div className="text-right leading-none">
            <div className="font-bold tracking-tight" style={{ fontSize: "17pt", fontStretch: "condensed" }}>
              {codigo}-{matrizDe({ familia: e.familia, tipo: e.tipo })}
            </div>
            <div className="mt-[2mm] font-bold" style={{ fontSize: "10pt" }}>
              {fmtFecha(e.fecha)}
            </div>
            <div className="mt-[1mm]" style={{ fontSize: "8.5pt" }}>
              Partida N°{(e.partida ?? "").slice(-5)}
            </div>
            <div className="mt-[1.5mm] font-black uppercase" style={{ fontSize: "17pt" }}>
              {e.colorNombre ?? ""}
            </div>
            <div className="mt-[1mm]" style={{ fontSize: "8.5pt" }}>
              Cantidad:{String(e.cantidad).padStart(5, "0")}
            </div>
          </div>
        </div>
        <div style={{ width: "68%" }}>
          <CodigoDeBarras texto={e.codigo} />
        </div>
      </div>
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
      <svg viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" className="block h-[11mm] w-full" role="img" aria-label={`Código de barras ${texto}`}>
        <rect width={total} height={40} fill="#fff" />
        {barras.map((b, i) => (
          <rect key={i} x={b.x} y={0} width={b.w} height={40} fill="#000" />
        ))}
      </svg>
      <div className="text-center font-mono text-[8pt] tracking-wider">{texto}</div>
    </div>
  );
}
