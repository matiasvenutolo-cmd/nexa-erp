"use client";

import { useActionState, useState } from "react";
import { ingresoMpAction, type EstadoForm } from "@/app/actions/materia-prima";
import { fmtPeso, parseCantidadAR } from "@/lib/presentaciones";

const BOTON = "btn btn-primary";

function Mensaje({ s }: { s: EstadoForm }) {
  if (s.error) return <div className="aviso aviso-error">{s.error}</div>;
  if (s.ok) return <div className="aviso aviso-ok">{s.ok}</div>;
  return null;
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-foreground-muted">{label}</span>
      {children}
    </label>
  );
}

type Mp = { id: number; nombre: string; tipo: string };

type CompraAbierta = { id: number; materiaPrimaId: number; materiaPrimaNombre: string; proveedor: string | null; pendienteKg: number; etiqueta: string };

/**
 * Ingreso de proveedor (reunión 20/11/2026): se elige primero la compra que
 * llega; de ahí salen el material, el proveedor y la cantidad pendiente, y la
 * compra pasa sola a entregada. Sin compra (stock inicial, devolución) se
 * elige el material a mano; si ese material tiene compras abiertas, hay que
 * explicar por qué no corresponde a ninguna.
 */
export function FormIngreso({ materias, hoy, compras = [], compraInicial }: { materias: Mp[]; hoy: string; compras?: CompraAbierta[]; compraInicial?: number | null }) {
  const [state, action, pendiente] = useActionState<EstadoForm, FormData>(ingresoMpAction, {});
  const [compraId, setCompraId] = useState(compras.some((c) => c.id === compraInicial) ? String(compraInicial) : compras.length ? "" : "sin");
  const compra = compras.find((c) => String(c.id) === compraId) ?? null;
  const [mpId, setMpId] = useState("");
  const abiertasDelMaterial = compraId === "sin" ? compras.filter((c) => String(c.materiaPrimaId) === mpId) : [];
  const [codigo, setCodigo] = useState("");
  const [cantidad, setCantidad] = useState(compra ? String(compra.pendienteKg).replace(".", ",") : "");
  const [proveedor, setProveedor] = useState(compra?.proveedor ?? "");
  // Registrado el ingreso, el código y la cantidad quedan vacíos para leer la
  // bolsa siguiente (listado de mejoras durante el uso, nov. 2026).
  const [estadoVisto, setEstadoVisto] = useState(state);
  if (state !== estadoVisto) {
    setEstadoVisto(state);
    if (state.ok) {
      setCodigo("");
      setCantidad("");
    }
  }
  const elegirCompra = (v: string) => {
    setCompraId(v);
    const c = compras.find((x) => String(x.id) === v);
    setCodigo("");
    setCantidad(c ? String(c.pendienteKg).replace(".", ",") : "");
    setProveedor(c?.proveedor ?? "");
  };
  const limpio = codigo.replace(/\s+/g, "");
  const kg = parseCantidadAR(cantidad);
  return (
    <form action={action} className="panel space-y-3">
      <Mensaje s={state} />
      {state.confirmar && (
        <div className="aviso aviso-alerta space-y-2">
          <p>{state.confirmar}</p>
          <input type="hidden" name="confirmado" value={kg ?? ""} />
          <p className="text-xs">Si la cantidad es correcta, tocá «Registrar ingreso» otra vez. Si no, corregila.</p>
        </div>
      )}
      <Campo label="¿De qué compra es? *">
        <select value={compraId} onChange={(e) => elegirCompra(e.target.value)} required className="input">
          <option value="" disabled>
            Elegí la compra que llegó…
          </option>
          {compras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.etiqueta}
            </option>
          ))}
          <option value="sin">No corresponde a ninguna compra (stock inicial, devolución…)</option>
        </select>
      </Campo>
      <input type="hidden" name="compraId" value={compra ? compra.id : ""} />
      <div className="grid gap-3 sm:grid-cols-2">
        {compra ? (
          <Campo label="Materia prima">
            <input type="hidden" name="materiaPrimaId" value={compra.materiaPrimaId} />
            <input readOnly value={compra.materiaPrimaNombre} className="input bg-surface-muted" />
          </Campo>
        ) : (
          <Campo label="Materia prima *">
            <select
              name="materiaPrimaId"
              required
              value={mpId}
              onChange={(e) => {
                setMpId(e.target.value);
                // Un código leído para otro material no sirve para este.
                setCodigo("");
              }}
              className="input"
              disabled={compraId !== "sin"}
            >
              <option value="" disabled>
                Elegí…
              </option>
              {materias.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <Campo label="Proveedor *">
          <input name="proveedor" required className={`input ${compra?.proveedor ? "bg-surface-muted" : ""}`} readOnly={Boolean(compra?.proveedor)} value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
        </Campo>
        <Campo label="Fecha de recepción *">
          <input name="fechaRecepcion" type="date" defaultValue={hoy} required className="input" />
        </Campo>
        <Campo label="Cantidad (kg) *">
          <input name="cantidadKg" inputMode="decimal" required className="input" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej.: 1.500 o 25,5" />
          {cantidad && (
            <span className={`mt-1 block text-xs font-semibold ${kg == null ? "text-[var(--estado-critico-fg)]" : "text-brand-azul"}`}>
              {kg == null ? "No se entiende la cantidad: usá punto para miles y coma para decimales." : `Se registran ${fmtPeso(kg)}${compra && kg < compra.pendienteKg - 1e-9 ? ` (la compra queda parcial: faltan ${fmtPeso(compra.pendienteKg - kg)})` : ""}`}
            </span>
          )}
        </Campo>
      </div>
      {abiertasDelMaterial.length > 0 && (
        <Campo label={`Este material tiene ${abiertasDelMaterial.length === 1 ? "una compra abierta" : "compras abiertas"}: ¿por qué este ingreso no es de ninguna? *`}>
          <input name="motivoSinCompra" required className="input" placeholder="Ej.: devolución de un cliente, muestra del proveedor" />
        </Campo>
      )}
      <Campo label="Código de barras del lote (27 dígitos: 000 + 4 MP + 8 proveedor/certificado + 12 lote) *">
        <input
          name="codigoBarra"
          required
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          className="input font-mono"
          placeholder="000…"
        />
      </Campo>
      {limpio && (
        <p className="text-xs text-foreground-muted">
          {limpio.length}/27 dígitos
          {limpio.length === 27 &&
            ` · producto ${limpio.slice(0, 3)} · MP ${limpio.slice(3, 7)} · proveedor/certificado ${limpio.slice(7, 15)} · lote ${limpio.slice(15)}`}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="conCertificado" value="1" defaultChecked />
          Llegó con certificado de calidad (se numera solo, por orden de llegada)
        </label>
        <Campo label="Link al certificado escaneado">
          <input name="archivoUrl" className="input" placeholder="opcional" />
        </Campo>
        <Campo label="Ubicación">
          <input name="ubicacion" className="input" placeholder="opcional" />
        </Campo>
      </div>
      <button type="submit" disabled={pendiente} className={BOTON}>
        Registrar ingreso
      </button>
    </form>
  );
}
