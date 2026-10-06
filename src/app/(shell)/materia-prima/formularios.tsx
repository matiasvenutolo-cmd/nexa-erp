"use client";

import { useActionState, useState } from "react";
import { ingresoMpAction, retiroMpAction, type EstadoForm } from "@/app/actions/materia-prima";
import { INYECTORAS } from "@/lib/inyectoras";

const BOTON = "rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60";

function Mensaje({ s }: { s: EstadoForm }) {
  if (s.error) return <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">{s.error}</div>;
  if (s.ok) return <div className="rounded-md bg-[var(--estado-ok-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-ok-fg)]">{s.ok}</div>;
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
  const limpio = codigo.replace(/\s+/g, "");
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <Mensaje s={state} />
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
          <input name="cantidadKg" type="number" step="any" min="0" required className="input" />
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

type Lote = { id: number; codigoBarra: string; materiaPrimaId: number; disponible: number };
type Ciclo = { id: number; etiqueta: string; abierto: boolean };

export function FormRetiro({
  materias,
  lotes,
  ciclos,
  usuarios,
  cicloInicial,
}: {
  materias: Mp[];
  lotes: Lote[];
  ciclos: Ciclo[];
  usuarios: { id: number; nombre: string }[];
  cicloInicial: number | null;
}) {
  const [state, action, pendiente] = useActionState<EstadoForm, FormData>(retiroMpAction, {});
  const [mp, setMp] = useState("");
  const [ciclo, setCiclo] = useState(cicloInicial ? String(cicloInicial) : "");
  const lotesDeMp = lotes.filter((l) => String(l.materiaPrimaId) === mp);
  const enCurso = ciclos.filter((c) => c.abierto);
  const cerrados = ciclos.filter((c) => !c.abierto);
  return (
    <form action={action} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <Mensaje s={state} />
      <Campo label="Ciclo de producción que alimenta (para la trazabilidad)">
        <select name="cicloId" value={ciclo} onChange={(e) => setCiclo(e.target.value)} className="input">
          <option value="">Sin ciclo (retiro sin producción asociada)</option>
          {enCurso.length > 0 && (
            <optgroup label="En curso">
              {enCurso.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.etiqueta}
                </option>
              ))}
            </optgroup>
          )}
          {cerrados.length > 0 && (
            <optgroup label="Cerrados recientemente">
              {cerrados.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.etiqueta}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </Campo>
      {enCurso.length === 0 && !cicloInicial && (
        <p className="text-xs text-foreground-muted">
          No hay producción en curso. Para vincular la materia prima a una partida, primero iniciá la producción en Producción → Nuevo ciclo
          y retirá desde ese ciclo.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo label="Materia prima *">
          <select name="materiaPrimaId" required value={mp} onChange={(e) => setMp(e.target.value)} className="input">
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
        <Campo label="Lote de MP (código de barras)">
          <select name="loteMpId" defaultValue="" className="input">
            <option value="">Stock sin lote (anterior al registro por lotes)</option>
            {lotesDeMp.map((l) => (
              <option key={l.id} value={l.id}>
                {l.codigoBarra} · {l.disponible} kg
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Cantidad (kg) *">
          <input name="cantidadKg" type="number" step="any" min="0" required className="input" />
        </Campo>
        {ciclo ? (
          <Campo label="Inyectora">
            <input className="input bg-surface-muted" readOnly value="La del ciclo elegido" />
          </Campo>
        ) : (
          <Campo label="Inyectora">
            <select name="inyectora" defaultValue="" className="input">
              <option value="">—</option>
              {INYECTORAS.map((n) => (
                <option key={n} value={n}>
                  Inyectora {n}
                </option>
              ))}
            </select>
          </Campo>
        )}
        <Campo label="Entregó">
          <select name="entregaId" defaultValue="" className="input">
            <option value="">—</option>
            {usuarios.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nombre}
              </option>
            ))}
          </select>
        </Campo>
      </div>
      <Campo label="Observaciones">
        <input name="observaciones" className="input" />
      </Campo>
      <button type="submit" disabled={pendiente} className={BOTON}>
        Registrar retiro
      </button>
    </form>
  );
}
