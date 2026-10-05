import Link from "next/link";
import { notFound } from "next/navigation";
import { obtenerDespachoParaRemito, remitoInterno } from "@/lib/data/despachos";
import { fmtFecha, fmtNumero } from "@/lib/format";
import { BotonImprimir } from "./imprimir";

/** Remito interno del sistema, por duplicado ("independientemente de que
 *  administración decida imprimirlo o imprimir el remito legal"). */
export default async function RemitoPage({ params }: { params: Promise<{ id: string; despachoId: string }> }) {
  const { id, despachoId } = await params;
  const r = await obtenerDespachoParaRemito(Number(despachoId));
  if (!r || r.pedidoId !== Number(id) || r.d.estado !== "ENTREGADO") notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/pedidos/${id}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← Pedido #{id}
        </Link>
        <BotonImprimir />
      </div>
      {(["ORIGINAL", "DUPLICADO"] as const).map((copia) => (
        <div key={copia} className="break-after-page rounded-lg border border-border bg-white p-6 text-sm text-black">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-semibold">NEXA — Conexiones Plásticas Sudamericana SRL</div>
              <div>Remito interno (no válido como factura)</div>
            </div>
            <div className="text-right">
              <div className="text-lg font-semibold">{remitoInterno(r.d.numeroInterno)}</div>
              <div>{copia}</div>
              <div>Fecha: {r.d.entregadoEn ? fmtFecha(r.d.entregadoEn) : fmtFecha(r.d.fecha)}</div>
              {r.d.numeroRemito && <div>Remito legal N° {r.d.numeroRemito}</div>}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div>Cliente: {r.clienteNombre}</div>
            <div>CUIT: {r.clienteCuit ?? "—"}</div>
            <div>Domicilio: {r.domicilio ?? "—"}</div>
            <div>Contacto: {r.contacto ?? "—"}</div>
            <div>Pedido: #{r.pedidoId}{r.numeroOrden ? ` (orden ${r.numeroOrden})` : ""}</div>
            <div>Entrega: {r.d.modoEntrega ?? "—"}{r.d.transporte ? ` · ${r.d.transporte}` : ""}</div>
          </div>
          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr className="border-b border-black text-left">
                <th className="py-1">Código</th>
                <th className="py-1">Descripción</th>
                <th className="py-1 text-right">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {r.items.map((it, i) => (
                <tr key={i} className="border-b border-gray-300">
                  <td className="py-1 font-mono">{it.codigo}</td>
                  <td className="py-1">{it.descripcion}</td>
                  <td className="py-1 text-right">{fmtNumero(it.unidades, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-10 grid grid-cols-2 gap-8">
            <div className="border-t border-black pt-1">Firma y aclaración — recibí conforme</div>
            <div className="border-t border-black pt-1">Entregó</div>
          </div>
        </div>
      ))}
    </div>
  );
}
