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

export function FormIngreso({ materias, hoy }: { materias: Mp[]; hoy: string }) {
  const [state, action, pendiente] = useActionState<EstadoForm, FormData>(ingresoMpAction, {});
  const [codigo, setCodigo] = useState("");
  const [cantidad, setCantidad] = useState("");
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
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Materia prima *">
          <select name="materiaPrimaId" required defaultValue="" className="input">
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
        <Campo label="Proveedor *">
          <input name="proveedor" required className="input" />
        </Campo>
        <Campo label="Fecha de recepción *">
          <input name="fechaRecepcion" type="date" defaultValue={hoy} required className="input" />
        </Campo>
        <Campo label="Cantidad (kg) *">
          <input name="cantidadKg" inputMode="decimal" required className="input" value={cantidad} onChange={(e) => setCantidad(e.target.value)} placeholder="Ej.: 1.500 o 25,5" />
          {cantidad && (
            <span className={`mt-1 block text-xs font-semibold ${kg == null ? "text-[var(--estado-critico-fg)]" : "text-brand-azul"}`}>
              {kg == null ? "No se entiende la cantidad: usá punto para miles y coma para decimales." : `Se registran ${fmtPeso(kg)}`}
            </span>
          )}
        </Campo>
      </div>
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
