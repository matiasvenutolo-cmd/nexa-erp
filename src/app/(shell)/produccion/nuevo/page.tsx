import { productosParaCiclo } from "@/lib/data/produccion";
import { getUsuariosPorRol } from "@/lib/data/usuarios";
import { datosParaProducto } from "@/app/actions/produccion";
import { FormularioCiclo } from "./formulario-ciclo";

export default async function NuevoCicloPage({
  searchParams,
}: {
  searchParams: Promise<{ productoId?: string }>;
}) {
  const { productoId } = await searchParams;
  const productoIdInicial = productoId ? Number(productoId) : null;
  const [productos, operarios, datosIniciales] = await Promise.all([
    productosParaCiclo(),
    getUsuariosPorRol("OPERARIO"),
    productoIdInicial ? datosParaProducto(productoIdInicial) : null,
  ]);

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold text-brand-azul-oscuro">Nuevo ciclo — inicio</h1>
      <p className="text-sm text-foreground-muted">
        Cargá el arranque del día. El cierre (golpes finales, producidas, colada) se carga aparte,
        al terminar la jornada.
      </p>
      <FormularioCiclo
        productos={productos}
        operarios={operarios.map((o) => ({ id: o.id, nombre: o.nombre }))}
        productoIdInicial={productoIdInicial}
        datosIniciales={datosIniciales}
      />
    </div>
  );
}
