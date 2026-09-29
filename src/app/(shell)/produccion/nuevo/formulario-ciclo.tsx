"use client";

import { useActionState, useState, useTransition } from "react";
import { crearCicloAction, datosParaProducto, golpesSugeridos, type FormState } from "@/app/actions/produccion";
import type { PedidoNecesitaProducto } from "@/lib/data/produccion";

type Producto = { id: number; codigo: string; descripcion: string; piezasPorGolpe: number | null };
type Operario = { id: number; nombre: string };
type Partida = { id: number; numero: number; fechaApertura: string };
type DatosProducto = { piezasPorGolpe: number | null; partidas: Partida[]; pedidos: PedidoNecesitaProducto[] };

const HOY = new Date().toISOString().slice(0, 10);

export function FormularioCiclo({
  productos,
  operarios,
  productoIdInicial,
  datosIniciales,
}: {
  productos: Producto[];
  operarios: Operario[];
  productoIdInicial: number | null;
  datosIniciales: DatosProducto | null;
}) {
  const [state, formAction, pendiente] = useActionState<FormState, FormData>(crearCicloAction, {});
  const [, startTransition] = useTransition();

  const [productoId, setProductoId] = useState<number | null>(productoIdInicial);
  const [piezasPorGolpe, setPiezasPorGolpe] = useState<number | null>(datosIniciales?.piezasPorGolpe ?? null);
  const [partidas, setPartidas] = useState<Partida[]>(datosIniciales?.partidas ?? []);
  const [pedidosDisponibles, setPedidosDisponibles] = useState<PedidoNecesitaProducto[]>(
    datosIniciales?.pedidos ?? [],
  );
  const [partidaId, setPartidaId] = useState<string>("");
  const [golpesInicio, setGolpesInicio] = useState<string>("");
  const [lineas, setLineas] = useState<Record<number, { incluido: boolean; cantidad: number }>>(
    Object.fromEntries((datosIniciales?.pedidos ?? []).map((p) => [p.pedidoId, { incluido: false, cantidad: p.cantidad }])),
  );

  function elegirProducto(idTexto: string) {
    const id = idTexto ? Number(idTexto) : null;
    setProductoId(id);
    setPartidaId("");
    setGolpesInicio("");
    if (!id) {
      setPiezasPorGolpe(null);
      setPartidas([]);
      setPedidosDisponibles([]);
      setLineas({});
      return;
    }
    startTransition(async () => {
      const d = await datosParaProducto(id);
      setPiezasPorGolpe(d.piezasPorGolpe);
      setPartidas(d.partidas);
      setPedidosDisponibles(d.pedidos);
      setLineas(
        Object.fromEntries(d.pedidos.map((p) => [p.pedidoId, { incluido: false, cantidad: p.cantidad }])),
      );
    });
  }

  function elegirPartida(id: string) {
    setPartidaId(id);
    if (!id) {
      setGolpesInicio("");
      return;
    }
    startTransition(async () => {
      const g = await golpesSugeridos(Number(id));
      setGolpesInicio(g != null ? String(g) : "");
    });
  }

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-border bg-surface p-4">
      {state.error && (
        <div className="rounded-md bg-[var(--estado-critico-bg)] px-3 py-2 text-sm font-medium text-[var(--estado-critico-fg)]">
          {state.error}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Fecha</span>
          <input name="fecha" type="date" required defaultValue={HOY} className="input" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Inyectora</span>
          <input name="inyectora" required className="input" placeholder="ej. Inyectora 1" />
        </label>
      </div>

      <label className="block text-sm">
        <span className="mb-1 block text-foreground-muted">Producto</span>
        <select
          name="productoId"
          required
          className="input"
          value={productoId ?? ""}
          onChange={(e) => elegirProducto(e.target.value)}
        >
          <option value="" disabled>
            Elegí un producto…
          </option>
          {productos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} · {p.descripcion}
            </option>
          ))}
        </select>
      </label>

      {productoId && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-foreground-muted">Partida</span>
              <select
                name="partidaId"
                className="input"
                value={partidaId}
                onChange={(e) => elegirPartida(e.target.value)}
              >
                <option value="">Partida nueva</option>
                {partidas.map((p) => (
                  <option key={p.id} value={p.id}>
                    N° {p.numero} — abierta el {p.fechaApertura}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-foreground-muted">Operario</span>
              <select name="operarioId" className="input" defaultValue="">
                <option value="">—</option>
                {operarios.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block text-foreground-muted">Golpes de inicio</span>
              <input
                name="golpesInicio"
                type="number"
                className="input"
                value={golpesInicio}
                onChange={(e) => setGolpesInicio(e.target.value)}
                placeholder={partidaId ? "sin ciclos previos" : ""}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-foreground-muted">Piezas por golpe</span>
              <input
                name="piezasPorGolpe"
                type="number"
                className="input"
                value={piezasPorGolpe ?? ""}
                onChange={(e) => setPiezasPorGolpe(e.target.value ? Number(e.target.value) : null)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-foreground-muted">Ciclo (segundos)</span>
              <input name="cicloSegundos" type="number" step="0.1" className="input" />
            </label>
          </div>

          <label className="block text-sm">
            <span className="mb-1 block text-foreground-muted">Modo</span>
            <input name="modo" className="input" placeholder="opcional" />
          </label>

          {pedidosDisponibles.length > 0 && (
            <div>
              <span className="mb-2 block text-sm text-foreground-muted">
                Pedidos que cubre esta tirada (opcional — por prioridad)
              </span>
              <div className="space-y-2 rounded-md border border-border p-3">
                {pedidosDisponibles.map((p) => {
                  const linea = lineas[p.pedidoId];
                  return (
                    <div key={p.pedidoId} className="flex items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={linea?.incluido ?? false}
                        onChange={(e) =>
                          setLineas((prev) => ({
                            ...prev,
                            [p.pedidoId]: { ...prev[p.pedidoId], incluido: e.target.checked },
                          }))
                        }
                      />
                      <span className="flex-1 text-foreground-muted">
                        Pedido #{p.pedidoId} · {p.clienteNombre} — pide {p.cantidad}
                      </span>
                      {linea?.incluido && (
                        <>
                          <input type="hidden" name="pedidoId" value={p.pedidoId} />
                          <input
                            type="number"
                            name="cantidadAsignada"
                            className="input w-24"
                            value={linea.cantidad}
                            onChange={(e) =>
                              setLineas((prev) => ({
                                ...prev,
                                [p.pedidoId]: { ...prev[p.pedidoId], cantidad: Number(e.target.value) },
                              }))
                            }
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <button
        type="submit"
        disabled={pendiente || !productoId}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-60"
      >
        Guardar inicio
      </button>
    </form>
  );
}
