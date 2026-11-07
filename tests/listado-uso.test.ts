/**
 * Listado de mejoras durante el uso (nov. 2026): cambios chicos.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db/client", async () => {
  const { holder } = await import("./helpers/db");
  return {
    get db() {
      return holder.db;
    },
  };
});

import { abrirBase, cerrarBase, holder, sembrar, type Semilla } from "./helpers/db";
import * as schema from "@/lib/db/schema";
import { perfilesDe } from "@/lib/data/usuarios";
import { crearPedido, editarPedido } from "@/lib/data/pedidos";

let s: Semilla;

async function pedidoCon(numeroOrden: string) {
  const r = await crearPedido({
    clienteId: s.cliente.id, fechaPedido: "2026-11-07", fechaEntregaPactada: "2026-11-20", numeroOrden, contacto: null, domicilioEntrega: null, modoEntrega: null,
    requiereColocacion: false, metodoPago: null, total: null, senia: null, numeroComprobante: null, observaciones: null, usuarioId: s.usuarios.ADMINISTRACION.id,
    lineas: [{ productoId: s.productos.rejNegro.id, unidadesPedidas: 10, colorTexto: null }],
  });
  if (!("id" in r)) throw new Error(r.error);
  return r.id;
}

beforeAll(async () => {
  s = await sembrar(await abrirBase());
});
afterAll(cerrarBase);

describe("Encargado con PIN", () => {
  it("entra con PIN como Encargado y con contraseña también", () => {
    expect(perfilesDe({ rol: "ENCARGADO", rolesAdicionales: [] }, "pin")).toEqual(["ENCARGADO"]);
    expect(perfilesDe({ rol: "ENCARGADO", rolesAdicionales: [] }, "clave")).toEqual(["ENCARGADO"]);
    // Gestión sigue sin PIN.
    expect(perfilesDe({ rol: "SUPERVISOR", rolesAdicionales: [] }, "pin")).toEqual([]);
  });
});

describe("N° de orden cargado a mano", () => {
  it("se guarda el del sistema de pedidos, no se repite y se puede corregir", async () => {
    const a = await pedidoCon("A-1001");
    const [p] = await holder.db!.select({ n: schema.pedido.numeroOrden }).from(schema.pedido).where(eq(schema.pedido.id, a));
    expect(p.n).toBe("A-1001");
    await expect(crearPedido({
      clienteId: s.cliente.id, fechaPedido: "2026-11-07", fechaEntregaPactada: null, numeroOrden: "A-1001", contacto: null, domicilioEntrega: null, modoEntrega: null,
      requiereColocacion: false, metodoPago: null, total: null, senia: null, numeroComprobante: null, observaciones: null, usuarioId: s.usuarios.ADMINISTRACION.id,
      lineas: [{ productoId: s.productos.rejNegro.id, unidadesPedidas: 5, colorTexto: null }],
    })).resolves.toMatchObject({ error: expect.stringMatching(/Ya existe/) });
    const b = await pedidoCon("A-1002");
    const base = { fechaEntregaPactada: null, contacto: null, domicilioEntrega: null, modoEntrega: null, requiereColocacion: false, observaciones: null };
    expect((await editarPedido(b, { ...base, numeroOrden: "A-1001" })).error).toMatch(/Ya existe/);
    expect((await editarPedido(b, { ...base, numeroOrden: "A-1003" })).error).toBeUndefined();
    const [q] = await holder.db!.select({ n: schema.pedido.numeroOrden }).from(schema.pedido).where(eq(schema.pedido.id, b));
    expect(q.n).toBe("A-1003");
  });
});
