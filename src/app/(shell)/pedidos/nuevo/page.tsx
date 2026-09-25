import Link from "next/link";
import { listarClientes } from "@/lib/data/clientes";
import { listarProductos } from "@/lib/data/catalogo";
import { getUsuarioActual } from "@/lib/session";
import { puedeVerPrecios } from "@/lib/auth/permisos";
import { FormularioPedido } from "./formulario-pedido";

export default async function NuevoPedidoPage() {
  const [usuario, clientes, productos] = await Promise.all([
    getUsuarioActual(),
    listarClientes(),
    listarProductos(),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/pedidos" className="text-sm text-foreground-muted hover:text-foreground">
          ← Pedidos
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-brand-azul-oscuro">Nuevo pedido</h1>
      </div>
      <FormularioPedido
        clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre }))}
        productos={productos}
        puedeVerPrecios={puedeVerPrecios(usuario.rol)}
      />
    </div>
  );
}
