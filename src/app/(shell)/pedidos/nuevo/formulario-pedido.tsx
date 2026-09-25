"use client";

import { useActionState, useMemo, useState } from "react";
import { crearPedidoAction, type FormState } from "@/app/actions/pedidos";
import { GRUPOS, coloresDeGrupo } from "@/lib/pedido-grupos";
import type { FilaProducto } from "@/lib/data/catalogo";
import { fmtNumero } from "@/lib/format";

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
  crearProducto: boolean;
  proveedorMasterId: string;
};

const filaVacia = (): Fila => ({
  key: siguienteKey++,
  grupo: GRUPOS[0].key,
  productoId: "",
  colorLibre: "",
  cantidad: "",
  crearProducto: false,
  proveedorMasterId: "",
});

let siguienteKey = 1;

export function FormularioPedido({
  clientes,
  productos,
  proveedores,
  puedeVerPrecios,
  puedeCrearProducto,
}: {
  clientes: { id: number; nombre: string }[];
  productos: FilaProducto[];
  proveedores: { id: number; nombre: string }[];
  puedeVerPrecios: boolean;
  puedeCrearProducto: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(crearPedidoAction, {});
  const hoy = new Date().toISOString().slice(0, 10);

  const [clienteModo, setClienteModo] = useState<"existente" | "nuevo">("existente");
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
      .filter((r) => r.cantidad > 0 && (r.prod || (r.fila.productoId === LIBRE && r.fila.colorLibre.trim())))
      .map((r) => ({
        productoId: r.prod?.id ?? null,
        colorTexto: r.prod?.colorNombre ?? r.fila.colorLibre.trim(),
        cantidad: r.cantidad,
        ...(r.fila.crearProducto && !r.prod
          ? {
              crearProducto: true,
              familia: r.grupo.familia,
              tipo: r.grupo.tipo,
              proveedorMasterId: r.fila.proveedorMasterId ? Number(r.fila.proveedorMasterId) : undefined,
            }
          : {}),
      })),
  );

  const totalBaldosas = filasResueltas.filter((r) => r.grupo.esPiso).reduce((s, r) => s + r.cantidad, 0);
  const totalAccesorios = filasResueltas.filter((r) => !r.grupo.esPiso).reduce((s, r) => s + r.cantidad, 0);

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
            <select name="clienteId" className="input" defaultValue="">
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
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Campo label="Contacto (teléfono)">
              <input name="contacto" className="input" placeholder="11 5555 5555" />
            </Campo>
            <Campo label="Domicilio de entrega">
              <input name="domicilio" className="input" placeholder="Calle, localidad, provincia" />
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
          </div>
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
                    {GRUPOS.filter((g) => g.esPiso).map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Accesorios">
                    {GRUPOS.filter((g) => !g.esPiso).map((g) => (
                      <option key={g.key} value={g.key}>
                        {g.label}
                      </option>
                    ))}
                  </optgroup>
                </select>

                {colores.length > 0 ? (
                  <select
                    value={f.productoId}
                    onChange={(e) => upd(f.key, { productoId: e.target.value })}
                    className="input w-auto min-w-[160px] flex-1"
                  >
                    <option value="">Color…</option>
                    {colores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.colorNombre} · stock {fmtNumero(p.stock, 0)}
                      </option>
                    ))}
                    <option value={LIBRE}>Otro (color especial)…</option>
                  </select>
                ) : (
                  <input
                    value={f.colorLibre}
                    onChange={(e) => upd(f.key, { colorLibre: e.target.value, productoId: LIBRE })}
                    placeholder="Color — sin catálogo todavía para este grupo"
                    className="input w-auto min-w-[220px] flex-1"
                  />
                )}
                {colores.length > 0 && f.productoId === LIBRE && (
                  <input
                    value={f.colorLibre}
                    onChange={(e) => upd(f.key, { colorLibre: e.target.value })}
                    placeholder="Color a pedido del cliente"
                    className="input w-auto min-w-[160px] flex-1"
                  />
                )}

                {puedeCrearProducto && f.productoId === LIBRE && f.colorLibre.trim() && (
                  <>
                    <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
                      <input
                        type="checkbox"
                        checked={f.crearProducto}
                        onChange={(e) => upd(f.key, { crearProducto: e.target.checked })}
                      />
                      Dar de alta en el catálogo
                    </label>
                    {f.crearProducto && (
                      <select
                        value={f.proveedorMasterId}
                        onChange={(e) => upd(f.key, { proveedorMasterId: e.target.value })}
                        className="input w-auto min-w-[140px]"
                      >
                        <option value="">Proveedor de master…</option>
                        {proveedores.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                      </select>
                    )}
                  </>
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
        <div className="flex justify-between">
          <span className="text-foreground-muted">Baldosas de piso</span>
          <span className="font-medium">{fmtNumero(totalBaldosas, 0)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-foreground-muted">Unidades de accesorios</span>
          <span className="font-medium">{fmtNumero(totalAccesorios, 0)}</span>
        </div>
      </aside>
    </form>
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
