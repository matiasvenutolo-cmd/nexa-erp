import Link from "next/link";
import { listarClientes } from "@/lib/data/clientes";
import { listarProductos } from "@/lib/data/catalogo";
import { listarProveedoresMaster } from "@/lib/data/proveedores";
import { coloresParaPedido } from "@/lib/data/colores";
import { getUsuarioActual } from "@/lib/session";
import { puedeCrearProducto } from "@/lib/auth/permisos";
import { verPrecios as verPreciosDe } from "@/lib/vista";
import { FormularioPedido } from "./formulario-pedido";

export default async function NuevoPedidoPage() {
  const [usuario, clientes, productos, proveedores, colores] = await Promise.all([
    getUsuarioActual(),
    listarClientes(),
    listarProductos(),
    listarProveedoresMaster(),
    coloresParaPedido(),
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
        clientes={clientes.map((c) => ({ id: c.id, nombre: c.nombre, telefono: c.telefono, domicilio: c.domicilio }))}
        colores={colores}
        productos={productos}
        proveedores={proveedores.map((p) => ({ id: p.id, nombre: p.nombre }))}
        puedeVerPrecios={await verPreciosDe(usuario)}
        puedeCrearProducto={puedeCrearProducto(usuario.rol)}
      />
    </div>
  );
}
