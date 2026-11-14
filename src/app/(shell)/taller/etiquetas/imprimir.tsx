"use client";

export function BotonImprimir() {
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.print()}>
      Imprimir
    </button>
  );
}
