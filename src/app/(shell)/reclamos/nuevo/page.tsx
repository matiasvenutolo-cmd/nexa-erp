import Link from "next/link";
import { redirect } from "next/navigation";
import { listarPedidos } from "@/lib/data/pedidos";
import { MOTIVO_DEVOLUCION_LABEL } from "@/lib/data/reclamos";
import { getUsuarioActual } from "@/lib/session";
import { puedeCrearReclamo } from "@/lib/auth/permisos";
import { fmtFecha } from "@/lib/format";
import { NuevoReclamo } from "../formularios";

export default async function NuevoReclamoPage({ searchParams }: { searchParams: Promise<{ pedido?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeCrearReclamo(usuario.rol)) redirect("/reclamos");
  const sp = await searchParams;
  const pedidos = await listarPedidos();
  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link href="/reclamos" className="text-sm text-foreground-muted hover:text-foreground">
          ← Reclamos
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Registrar reclamo</h1>
      </div>
      <NuevoReclamo
        pedidoId={sp.pedido ? Number(sp.pedido) : null}
        pedidos={pedidos.map((p) => ({ id: p.id, etiqueta: `#${p.id} · ${p.clienteNombre} · ${fmtFecha(p.fechaPedido)}` }))}
        motivos={Object.entries(MOTIVO_DEVOLUCION_LABEL).map(([valor, etiqueta]) => ({ valor, etiqueta }))}
      />
    </div>
  );
}
