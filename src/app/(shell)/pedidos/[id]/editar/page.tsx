import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { obtenerPedido } from "@/lib/data/pedidos";
import { getUsuarioActual } from "@/lib/session";
import { puedeCrearPedido } from "@/lib/auth/permisos";
import { verPrecios as verPreciosDe } from "@/lib/vista";
import { FormularioEdicion } from "./formulario-edicion";
import { EditorLineas } from "./lineas";
import { productosParaCiclo } from "@/lib/data/produccion";

export default async function EditarPedidoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pedidoId = Number(id);
  if (!Number.isFinite(pedidoId)) notFound();

  const usuario = await getUsuarioActual();
  if (!puedeCrearPedido(usuario.rol)) redirect(`/pedidos/${pedidoId}`);

  const pedido = await obtenerPedido(pedidoId);
  if (!pedido) notFound();
  if (pedido.estado === "CANCELADO") redirect(`/pedidos/${pedidoId}`);
  // Hasta «listo para despachar» se cambian los productos; con entregas, pedido nuevo.
  const entregado = pedido.estado === "ENTREGADO" || pedido.estado === "PARCIALMENTE_DESPACHADO" || pedido.lineas.some((l) => l.unidadesDespachadas > 0);
  const productos = await productosParaCiclo();

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <Link href={`/pedidos/${pedidoId}`} className="text-sm text-foreground-muted hover:text-foreground">
          ← {pedido.clienteNombre}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Editar pedido</h1>
      </div>
      <section className="panel space-y-3">
        <h2 className="panel-titulo">Productos del pedido</h2>
        {entregado ? (
          <p className="text-sm text-foreground-muted">El pedido ya tiene entregas: lo que agregue el cliente va como un pedido nuevo.</p>
        ) : (
          <EditorLineas
            pedidoId={pedidoId}
            renglones={pedido.lineas
              .filter((l) => l.productoId != null)
              .map((l) => ({ lineaId: l.id, codigo: l.productoCodigo ?? "", descripcion: l.productoDescripcion ?? "", color: l.productoColorNombre, unidades: l.unidadesPedidas, armadas: l.unidadesArmadas }))}
            productos={productos.map((p) => ({ id: p.id, codigo: p.codigo, descripcion: p.descripcion }))}
          />
        )}
      </section>
      <section className="panel">
        <h2 className="panel-titulo">Datos comerciales y de entrega</h2>
        <FormularioEdicion pedido={pedido} puedeVerPrecios={await verPreciosDe(usuario)} />
      </section>
    </div>
  );
}
