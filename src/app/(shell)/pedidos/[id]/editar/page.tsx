import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { obtenerPedido } from "@/lib/data/pedidos";
import { getUsuarioActual } from "@/lib/session";
import { puedeVerPrecios, puedeCrearPedido } from "@/lib/auth/permisos";
import { FormularioEdicion } from "./formulario-edicion";

export default async function EditarPedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pedidoId = Number(id);
  if (!Number.isFinite(pedidoId)) notFound();

  const usuario = await getUsuarioActual();
  if (!puedeCrearPedido(usuario.rol)) redirect(`/pedidos/${pedidoId}`);

  const pedido = await obtenerPedido(pedidoId);
  if (!pedido) notFound();
  if (pedido.estado === "CANCELADO") redirect(`/pedidos/${pedidoId}`);

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Link href={`/pedidos/${pedidoId}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← {pedido.clienteNombre}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Editar pedido</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Se editan los datos comerciales y de entrega. Los ítems del pedido no se pueden cambiar
          desde acá — si hace falta agregar o quitar un producto, avisá a quien armó el pedido.
        </p>
      </div>
      <FormularioEdicion pedido={pedido} puedeVerPrecios={puedeVerPrecios(usuario.rol)} />
    </div>
  );
}
