"use client";

import { useActionState, useState } from "react";

export type EstadoAccion = { error?: string; ok?: string };
type Accion = (prev: EstadoAccion, fd: FormData) => Promise<EstadoAccion>;

const nuevoToken = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/**
 * Formulario de una acción con resultado visible: qué pasó (verde) o qué hay
 * que corregir (rojo), junto al botón. Mientras envía, el botón se deshabilita
 * y la clave anti-repetición (`token`) se mantiene: un doble toque no duplica.
 */
export function FormAccion({
  accion,
  boton,
  children,
  ocultos = {},
  claseBoton = "btn btn-primary",
  className = "flex flex-wrap items-end gap-2",
  confirmar,
  pie,
}: {
  accion: Accion;
  boton: React.ReactNode;
  children?: React.ReactNode;
  ocultos?: Record<string, string | number | boolean | null | undefined>;
  claseBoton?: string;
  className?: string;
  /** Texto de confirmación (window.confirm) antes de enviar. */
  confirmar?: string;
  pie?: React.ReactNode;
}) {
  const [state, action, pendiente] = useActionState<EstadoAccion, FormData>(accion, {});
  const [claves] = useState(() => new WeakMap<EstadoAccion, string>());
  if (!claves.has(state)) claves.set(state, nuevoToken());
  const token = claves.get(state)!;
  return (
    <form
      action={action}
      className={className}
      onSubmit={(e) => {
        if (confirmar && !window.confirm(confirmar)) e.preventDefault();
      }}
    >
      <input type="hidden" name="token" value={token} />
      {Object.entries(ocultos).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={String(v)} />))}
      {children}
      <button type="submit" disabled={pendiente} className={claseBoton}>
        {pendiente ? "Guardando…" : boton}
      </button>
      {pie}
      {state.error && <p className="aviso aviso-error w-full">{state.error}</p>}
      {state.ok && <p className="aviso aviso-ok w-full">{state.ok}</p>}
    </form>
  );
}
