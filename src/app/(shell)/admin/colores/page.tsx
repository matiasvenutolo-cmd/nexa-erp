import Link from "next/link";
import { listarColores, mastersDisponibles, type FilaColor } from "@/lib/data/colores";
import { listarClientes } from "@/lib/data/clientes";
import { listarProveedoresMaster } from "@/lib/data/proveedores";
import { actualizarColorAction, crearColorEspecialAction } from "@/app/actions/admin";
import { fmtDia } from "@/lib/format";
import { Aviso, BOTON, TD, TH, UltimaModificacion, exigirSeccion } from "../comunes";

type Opcion = { id: number; nombre: string };

export default async function AdminColoresPage({
  searchParams,
}: {
  searchParams: Promise<{ texto?: string; especiales?: string; ok?: string; error?: string }>;
}) {
  await exigirSeccion("/admin/colores");
  const sp = await searchParams;
  const soloEspeciales = sp.especiales === "1";
  const [colores, clientes, proveedores, masters] = await Promise.all([
    listarColores({ texto: sp.texto, soloEspeciales }),
    listarClientes(),
    listarProveedoresMaster(),
    mastersDisponibles(),
  ]);
  const opciones = {
    clientes: clientes.map((c) => ({ id: c.id, nombre: c.nombre })),
    proveedores: proveedores.map((p) => ({ id: p.id, nombre: p.nombre })),
    masters,
  };
  const volver = `/admin/colores?${new URLSearchParams({ ...(sp.texto ? { texto: sp.texto } : {}), ...(soloEspeciales ? { especiales: "1" } : {}) })}`;

  return (
    <div className="space-y-4">
      <Aviso ok={sp.ok} error={sp.error} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <form action="/admin/colores" className="flex flex-wrap items-center gap-3">
          <input
            name="texto"
            defaultValue={sp.texto ?? ""}
            placeholder="Buscar por color, cliente o master"
            className="input w-64"
          />
          <label className="flex items-center gap-1.5 text-sm text-foreground-muted">
            <input type="checkbox" name="especiales" value="1" defaultChecked={soloEspeciales} />
            Sólo colores especiales
          </label>
          <button type="submit" className="rounded-md bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground">
            Buscar
          </button>
          {(sp.texto || soloEspeciales) && (
            <Link href="/admin/colores" className="text-sm text-foreground-muted hover:text-foreground">
              Limpiar
            </Link>
          )}
        </form>
      </div>

      <details className="rounded-lg border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Registrar un color especial</summary>
        <p className="mt-2 text-sm text-foreground-muted">
          Para un color a pedido de un cliente, así se puede repetir más adelante. Si se carga desde un pedido con
          “Otro (color especial)”, queda registrado solo con el cliente del pedido como solicitante.
        </p>
        <form action={crearColorEspecialAction} className="mt-3 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="volver" value={volver} />
          <Campo label="Nombre del color *">
            <input name="nombre" required className="input" placeholder="ej. Azul Carrefour" />
          </Campo>
          <Campo label="Solicitante">
            <Select name="clienteId" opciones={opciones.clientes} />
          </Campo>
          <Campo label="Proveedor del master">
            <Select name="proveedorMasterId" opciones={opciones.proveedores} />
          </Campo>
          <Campo label="Nombre del master">
            <input name="masterNombre" className="input" />
          </Campo>
          <Campo label="Código del master / color">
            <input name="masterCodigo" className="input" />
          </Campo>
          <Campo label="Master en materia prima">
            <Select name="masterMateriaPrimaId" opciones={opciones.masters} />
          </Campo>
          <div className="sm:col-span-2">
            <Campo label="Observaciones">
              <input name="observaciones" className="input" />
            </Campo>
          </div>
          <div className="flex items-end">
            <button type="submit" className={BOTON}>
              Registrar
            </button>
          </div>
        </form>
      </details>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                <th className={TH}>Color</th>
                <th className={TH}>Código</th>
                <th className={TH}>Tipo</th>
                <th className={TH}>Proveedor</th>
                <th className={TH}>Master / código</th>
                <th className={TH}>Solicitante</th>
                <th className={TH}>Última modificación</th>
              </tr>
            </thead>
            <tbody>
              {colores.map((c) => (
                <FilaColorAdmin key={c.id} c={c} opciones={opciones} volver={volver} />
              ))}
              {colores.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-foreground-muted">
                    No hay colores que coincidan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-xs text-foreground-muted">
        El nombre de un color no se edita acá: está en el código y la descripción de sus productos y en los pedidos
        históricos.
      </p>
    </div>
  );
}

function FilaColorAdmin({
  c,
  opciones,
  volver,
}: {
  c: FilaColor;
  opciones: { clientes: Opcion[]; proveedores: Opcion[]; masters: Opcion[] };
  volver: string;
}) {
  const tipo = c.oficial ? "Oficial" : c.especial ? "Especial" : "Sin clasificar";
  const claseTipo = c.oficial ? "badge-ok" : c.especial ? "badge-bajo" : "bg-surface-muted text-foreground-muted";
  return (
    <tr id={`color-${c.id}`} className="border-b border-border last:border-0">
      <td className={TD}>
        <details>
          <summary className="cursor-pointer font-medium text-foreground">{c.nombre}</summary>
          <form action={actualizarColorAction} className="mt-3 grid w-[min(36rem,80vw)] gap-2 sm:grid-cols-2">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="volver" value={volver} />
            <input type="hidden" name="ancla" value={`color-${c.id}`} />
            {!c.oficial && (
              <label className="flex items-center gap-1.5 text-sm sm:col-span-2">
                <input type="checkbox" name="especial" value="1" defaultChecked={c.especial} />
                Color especial (a pedido de un cliente)
              </label>
            )}
            <Campo label="Solicitante">
              <Select name="clienteId" opciones={opciones.clientes} valor={c.clienteId} />
            </Campo>
            <Campo label="Proveedor del master">
              <Select name="proveedorMasterId" opciones={opciones.proveedores} valor={c.proveedorMasterId} />
            </Campo>
            <Campo label="Nombre del master">
              <input name="masterNombre" defaultValue={c.masterNombre ?? ""} className="input" />
            </Campo>
            <Campo label="Código del master / color">
              <input name="masterCodigo" defaultValue={c.masterCodigo ?? ""} className="input" />
            </Campo>
            <Campo label="Master en materia prima">
              <Select name="masterMateriaPrimaId" opciones={opciones.masters} valor={c.masterMateriaPrimaId} />
            </Campo>
            <Campo label="Observaciones">
              <input name="observaciones" defaultValue={c.observaciones ?? ""} className="input" />
            </Campo>
            <Campo label="Motivo del cambio">
              <input name="motivo" className="input" placeholder="opcional" />
            </Campo>
            <div className="flex items-end">
              <button type="submit" className={BOTON}>
                Guardar
              </button>
            </div>
          </form>
        </details>
        <div className="text-xs text-foreground-muted">
          {c.productos} producto{c.productos === 1 ? "" : "s"}
          {c.especial && ` · registrado ${fmtDia(c.creadoEn)}`}
        </div>
      </td>
      <td className={`${TD} font-mono text-xs`}>{c.iniciales}</td>
      <td className={TD}>
        <span className={`badge-estado ${claseTipo}`}>{tipo}</span>
      </td>
      <td className={TD}>{c.proveedorNombre ?? "—"}</td>
      <td className={TD}>
        <div>{c.masterNombre ?? "—"}</div>
        {c.masterCodigo && <div className="text-xs text-foreground-muted">{c.masterCodigo}</div>}
        {c.masterMateriaPrimaNombre && <div className="text-xs text-foreground-muted">MP: {c.masterMateriaPrimaNombre}</div>}
      </td>
      <td className={TD}>{c.clienteNombre ?? "—"}</td>
      <td className={TD}>
        <UltimaModificacion valor={c.ultimaModificacion} />
      </td>
    </tr>
  );
}

function Select({ name, opciones, valor }: { name: string; opciones: Opcion[]; valor?: number | null }) {
  return (
    <select name={name} defaultValue={valor ?? ""} className="input">
      <option value="">—</option>
      {opciones.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nombre}
        </option>
      ))}
    </select>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-foreground-muted">{label}</span>
      {children}
    </label>
  );
}
