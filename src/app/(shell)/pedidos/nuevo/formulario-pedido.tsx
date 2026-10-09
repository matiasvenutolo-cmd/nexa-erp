"use client";

import { useActionState, useMemo, useState } from "react";
import { crearPedidoAction, type FormState } from "@/app/actions/pedidos";
import { GRUPOS, coloresDeGrupo } from "@/lib/pedido-grupos";
import type { FilaProducto } from "@/lib/data/catalogo";
import { fmtNumero, hoyISO } from "@/lib/format";
import { claveColor } from "@/lib/catalogo-normalizacion";
import { resumirPedido } from "@/lib/resumen-pedido";
import { ResumenPedido } from "@/components/resumen-pedido";

const LIBRE = "LIBRE";
const METODOS_PAGO = [
  "Efectivo",
  "Transferencia",
  "Contado / transferencia",
  "Tarjeta de crédito",
  "Cheque",
  "Mercado Pago",
];

type Fila = {
  key: number;
  grupo: string;
  productoId: string;
  colorLibre: string;
  cantidad: string;
  proveedorMasterId: string;
  masterNombre: string;
  masterCodigo: string;
};

type ColorRegistrado = {
  id: number;
  nombre: string;
  especial: boolean;
  oficial: boolean;
  proveedorMasterId: number | null;
  clienteNombre: string | null;
  masterNombre: string | null;
  masterCodigo: string | null;
};

const filaVacia = (): Fila => ({
  key: siguienteKey++,
  grupo: GRUPOS[0].key,
  productoId: "",
  colorLibre: "",
  cantidad: "",
  proveedorMasterId: "",
  masterNombre: "",
  masterCodigo: "",
});

const clave = claveColor;

let siguienteKey = 1;

export function FormularioPedido({
  clientes,
  colores: coloresRegistrados,
  productos,
  proveedores,
  puedeVerPrecios,
  puedeCrearProducto,
}: {
  clientes: { id: number; nombre: string; telefono: string | null; domicilio: string | null }[];
  colores: ColorRegistrado[];
  productos: FilaProducto[];
  proveedores: { id: number; nombre: string }[];
  puedeVerPrecios: boolean;
  puedeCrearProducto: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(crearPedidoAction, {});
  const hoy = hoyISO();

  const [clienteModo, setClienteModo] = useState<"existente" | "nuevo">("existente");
  const [contacto, setContacto] = useState("");
  const [domicilio, setDomicilio] = useState("");
  // Sólo grupos con productos reales: un renglón tiene que ser un producto
  // del catálogo (Definiciones pendientes, respuesta 6).
  const grupos = useMemo(() => GRUPOS.filter((g) => coloresDeGrupo(productos, g).length > 0), [productos]);
  const especialPorClave = useMemo(
    () => new Map(coloresRegistrados.map((c) => [clave(c.nombre), c])),
    [coloresRegistrados],
  );

  const elegirCliente = (id: string) => {
    const c = clientes.find((x) => String(x.id) === id);
    // Levanta los datos del cliente si ya compró antes; no pisa lo que se tipeó.
    if (c?.telefono && !contacto) setContacto(c.telefono);
    if (c?.domicilio && !domicilio) setDomicilio(c.domicilio);
  };
  const [filas, setFilas] = useState<Fila[]>([filaVacia()]);
  const [requiereColocacion, setRequiereColocacion] = useState(false);

  const upd = (key: number, patch: Partial<Fila>) =>
    setFilas((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const filasResueltas = useMemo(
    () =>
      filas.map((f) => {
        const grupo = GRUPOS.find((g) => g.key === f.grupo)!;
        const colores = coloresDeGrupo(productos, grupo);
        const prod = f.productoId && f.productoId !== LIBRE ? colores.find((p) => String(p.id) === f.productoId) : undefined;
        const cantidad = Number(f.cantidad) || 0;
        return { fila: f, grupo, colores, prod, cantidad };
      }),
    [filas, productos],
  );

  const lineasJson = JSON.stringify(
    filasResueltas
      .filter((r) => r.cantidad > 0)
      .map((r) => ({
        productoId: r.prod?.id ?? null,
        colorTexto: r.prod?.colorNombre ?? r.fila.colorLibre.trim(),
        cantidad: r.cantidad,
        ...(!r.prod && r.fila.productoId === LIBRE
          ? {
              crearProducto: true,
              familia: r.grupo.familia,
              tipo: r.grupo.tipo,
              proveedorMasterId: r.fila.proveedorMasterId ? Number(r.fila.proveedorMasterId) : undefined,
              masterNombre: r.fila.masterNombre.trim() || undefined,
              masterCodigo: r.fila.masterCodigo.trim() || undefined,
            }
          : {}),
      })),
  );

  const resumen = resumirPedido(
    filasResueltas
      .filter((r) => r.cantidad > 0 && (r.prod || (r.fila.productoId === LIBRE && r.fila.colorLibre.trim())))
      .map((r) => ({
        productoId: r.prod?.id ?? -1,
        codigo: r.prod?.codigo ?? null,
        familia: r.grupo.familia,
        tipo: r.grupo.tipo,
        esAccesorio: !r.grupo.esPiso,
        colorNombre: r.prod?.colorNombre ?? r.fila.colorLibre.trim(),
        unidades: r.cantidad,
        m2PorUnidad: r.prod?.m2PorUnidad ?? null,
      })),
  );

  return (
    <form action={formAction} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <input type="hidden" name="lineas" value={lineasJson} />

      <div className="space-y-5">
        {state.error && (
          <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">
            {state.error}
          </div>
        )}

        <Bloque titulo="Cliente">
          <div className="mb-2 flex gap-4 text-sm">
            {(["existente", "nuevo"] as const).map((m) => (
              <label key={m} className="flex items-center gap-1.5">
                <input type="radio" checked={clienteModo === m} onChange={() => setClienteModo(m)} />
                {m === "existente" ? "Cliente existente" : "Cliente nuevo"}
              </label>
            ))}
          </div>
          {clienteModo === "existente" ? (
            <select name="clienteId" className="input" defaultValue="" onChange={(e) => elegirCliente(e.target.value)}>
              <option value="">Elegí un cliente…</option>
              {clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          ) : (
            <input name="clienteNuevo" placeholder="Nombre del cliente nuevo" className="input" />
          )}
          {clienteModo === "nuevo" && (
            <p className="mt-1 text-xs text-foreground-muted">
              Si ya existe un cliente con ese nombre, se usa el existente. El teléfono y el domicilio quedan guardados
              para la próxima compra.
            </p>
          )}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Campo label="Contacto (teléfono)">
              <input name="contacto" value={contacto} onChange={(e) => setContacto(e.target.value)} className="input" placeholder="11 5555 5555" />
            </Campo>
            <Campo label="Domicilio de entrega">
              <input name="domicilio" value={domicilio} onChange={(e) => setDomicilio(e.target.value)} className="input" placeholder="Calle, localidad, provincia" />
            </Campo>
          </div>
        </Bloque>

        <Bloque titulo="Datos del pedido">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo label="N° de orden (opcional)">
              <input name="numeroOrden" className="input" placeholder="ej. 81475" />
            </Campo>
            <Campo label="Fecha" requerido>
              <input type="date" name="fechaPedido" defaultValue={hoy} required className="input" />
            </Campo>
            <Campo label="Fecha de entrega comprometida">
              <input type="date" name="fechaEntregaPactada" min={hoy} className="input" />
            </Campo>
          </div>
          <p className="mt-1 text-xs text-foreground-muted">
            La fecha de entrega ordena la cola de producción. Sin fecha, cuenta la del pedido.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Campo label="Modo de entrega">
              <select name="modoEntrega" className="input" defaultValue="">
                <option value="">—</option>
                <option value="Retiro en fábrica">Retiro en fábrica</option>
                <option value="Flete">Flete</option>
              </select>
            </Campo>
            <label className="mt-6 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiereColocacion}
                onChange={(e) => setRequiereColocacion(e.target.checked)}
              />
              Requiere servicio de colocación
              <input type="hidden" name="requiereColocacion" value={requiereColocacion ? "1" : "0"} />
            </label>
          </div>
        </Bloque>

        <Bloque titulo="Pisos y accesorios">
          <div className="space-y-2">
            {filasResueltas.map(({ fila: f, grupo, colores, prod }) => (
              <div key={f.key} className="flex flex-wrap items-center gap-2">
                <select
                  value={f.grupo}
                  onChange={(e) => upd(f.key, { grupo: e.target.value, productoId: "", colorLibre: "" })}
                  className="input w-auto min-w-[170px] flex-1"
                >
                  <optgroup label="Pisos">
                    {grupos.filter((g) => g.esPiso).map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Accesorios">
                    {grupos.filter((g) => !g.esPiso).map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.label}
                      </option>
                    ))}
                  </optgroup>
                </select>

                <select
                  value={f.productoId}
                  onChange={(e) => upd(f.key, { productoId: e.target.value })}
                  className="input w-auto min-w-[160px] flex-1"
                >
                  <option value="">Color…</option>
                  {colores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.colorNombre}
                      {p.colorEspecial ? " (especial)" : ""} · stock {fmtNumero(p.stock, 0)}
                    </option>
                  ))}
                  {puedeCrearProducto && <option value={LIBRE}>Otro (color especial)…</option>}
                </select>

                {f.productoId === LIBRE && (
                  <ColorEspecial
                    fila={f}
                    proveedores={proveedores}
                    registrados={coloresRegistrados}
                    especialPorClave={especialPorClave}
                    onChange={(patch) => upd(f.key, patch)}
                  />
                )}

                <input
                  type="number"
                  min={1}
                  step={1}
                  value={f.cantidad}
                  onChange={(e) => upd(f.key, { cantidad: e.target.value })}
                  placeholder={grupo.esPiso ? "baldosas" : "unidades"}
                  className="input w-28"
                />
                {grupo.esPiso && prod?.stock != null && Number(f.cantidad) > 0 && (
                  <span className="text-xs text-foreground-muted">
                    stock {fmtNumero(prod.stock, 0)}
                  </span>
                )}

                {filas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setFilas((xs) => xs.filter((x) => x.key !== f.key))}
                    className="text-sm text-[var(--estado-critico-fg)] hover:underline"
                  >
                    Quitar
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setFilas((xs) => [...xs, filaVacia()])}
            className="mt-3 text-sm font-medium text-accent hover:underline"
          >
            + Agregar ítem
          </button>
        </Bloque>

        {puedeVerPrecios && (
          <Bloque titulo="Pago">
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo label="Método de pago">
                <select name="metodoPago" className="input" defaultValue="">
                  <option value="">—</option>
                  {METODOS_PAGO.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Campo>
              <Campo label="Total">
                <input name="total" type="number" min={0} step="0.01" className="input" />
              </Campo>
              <Campo label="Seña">
                <input name="senia" type="number" min={0} step="0.01" className="input" />
              </Campo>
              <Campo label="N° de comprobante de pago">
                <input name="numeroComprobante" className="input" />
              </Campo>
            </div>
          </Bloque>
        )}

        <Bloque titulo="Observaciones">
          <textarea name="observaciones" rows={2} className="input" />
        </Bloque>

        <button
          type="submit"
          className="w-full rounded-md bg-accent py-2.5 text-sm font-medium text-accent-foreground hover:opacity-90 sm:w-auto sm:px-6"
        >
          Crear pedido
        </button>
      </div>

      <aside className="h-fit space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
        <div className="text-xs font-medium uppercase tracking-wide text-foreground-muted">Resumen</div>
        <ResumenPedido r={resumen} />
      </aside>
    </form>
  );
}

/**
 * Color especial: se elige uno ya registrado (para repetirlo) o se registra
 * uno nuevo con su proveedor y master. Nunca queda como texto suelto.
 */
function ColorEspecial({
  fila,
  proveedores,
  registrados,
  especialPorClave,
  onChange,
}: {
  fila: Fila;
  proveedores: { id: number; nombre: string }[];
  registrados: ColorRegistrado[];
  especialPorClave: Map<string, ColorRegistrado>;
  onChange: (patch: Partial<Fila>) => void;
}) {
  const existente = fila.colorLibre.trim() ? especialPorClave.get(clave(fila.colorLibre)) : undefined;
  const listaId = `colores-registrados-${fila.key}`;
  return (
    <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-surface-muted p-2">
      <input
        value={fila.colorLibre}
        list={listaId}
        onChange={(e) => {
          const nombre = e.target.value;
          const reg = especialPorClave.get(clave(nombre));
          onChange({
            colorLibre: nombre,
            ...(reg?.proveedorMasterId ? { proveedorMasterId: String(reg.proveedorMasterId) } : {}),
          });
        }}
        placeholder="Nombre del color (uno solo)"
        className="input w-auto min-w-[180px] flex-1"
      />
      <datalist id={listaId}>
        {registrados
          .filter((c) => c.especial || !c.oficial)
          .map((c) => (
            <option key={c.id} value={c.nombre}>
              {[c.clienteNombre, c.masterCodigo].filter(Boolean).join(" · ")}
            </option>
          ))}
      </datalist>
      <select
        value={fila.proveedorMasterId}
        onChange={(e) => onChange({ proveedorMasterId: e.target.value })}
        className="input w-auto min-w-[150px]"
        required
      >
        <option value="">Proveedor de master…</option>
        {proveedores.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nombre}
          </option>
        ))}
      </select>
      {existente ? (
        <span className="text-xs text-foreground-muted">
          Color ya registrado{existente.clienteNombre ? ` (pedido por ${existente.clienteNombre})` : ""}
          {existente.masterNombre || existente.masterCodigo
            ? ` · master ${[existente.masterNombre, existente.masterCodigo].filter(Boolean).join(" ")}`
            : ""}
          — se reutiliza.
        </span>
      ) : (
        <>
          <input
            value={fila.masterNombre}
            onChange={(e) => onChange({ masterNombre: e.target.value })}
            placeholder="Nombre del master (opcional)"
            className="input w-auto min-w-[170px]"
          />
          <input
            value={fila.masterCodigo}
            onChange={(e) => onChange({ masterCodigo: e.target.value })}
            placeholder="Código del master (opcional)"
            className="input w-auto min-w-[150px]"
          />
        </>
      )}
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-foreground">{titulo}</h2>
      {children}
    </div>
  );
}

function Campo({ label, requerido, children }: { label: string; requerido?: boolean; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-foreground-muted">
        {label}
        {requerido && " *"}
      </span>
      {children}
    </label>
  );
}
