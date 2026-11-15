/**
 * Compras y materia prima (pedido de NEXA, nov. 2026): Compras ejecuta lo que
 * pide Materia prima eligiendo proveedor y cargando montos; ficha de
 * proveedores con historial y cumplimiento; Materia prima ve el estado de
 * compra de cada material en su tabla de stock.
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
import { actualizarCompra, ejecutarCompra, listarCompras, montosDe, solicitarCompra } from "@/lib/data/compras";
import { cumplimientoDe, guardarProveedor, listarProveedores } from "@/lib/data/proveedores";
import { situacionCompraMp } from "@/lib/data/necesidad-mp";
import { actualizarMinMaxMateriaPrima } from "@/lib/data/stock-config";
import { ingresarMateriaPrima } from "@/lib/data/materia-prima";
import { hoyISO, sumarDias } from "@/lib/format";

let s: Semilla;
const db = () => holder.db!;
const hoy = hoyISO();
let berma: number;
let lote = 900;

async function ingresar(materiaPrimaId: number, cantidadKg: number, compraId: number) {
  lote++;
  const r = await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, { materiaPrimaId, proveedor: "Berma", fechaRecepcion: hoy, cantidadKg, codigoBarra: `000003112345678${String(lote).padStart(12, "0")}`, conCertificado: false, compraId });
  expect(r.error).toBeUndefined();
}

beforeAll(async () => {
  s = await sembrar(await abrirBase());
});
afterAll(cerrarBase);

describe("montos de la compra", () => {
  it("con el precio por kg calcula el total, y con el total el precio", () => {
    expect(montosDe(1000, 1850.5, null)).toMatchObject({ precioKg: 1850.5, montoTotal: 1850500 });
    expect(montosDe(400, null, 1000000)).toMatchObject({ precioKg: 2500, montoTotal: 1000000 });
    expect(montosDe(10, -1, null).error).toMatch(/mayor o igual a cero/);
  });
});

describe("ficha de proveedores", () => {
  it("la carga Compras; el nombre no se repite aunque cambien las mayúsculas", async () => {
    expect((await guardarProveedor(s.usuarios.MATERIA_PRIMA, null, { nombre: "Berma" })).error).toMatch(/permiso/);
    const r = await guardarProveedor(s.usuarios.COMPRAS, null, { nombre: "  Berma ", cuit: "30-11111111-1", contacto: "Laura", email: "ventas@berma.test" });
    expect(r.error).toBeUndefined();
    berma = r.id!;
    expect((await guardarProveedor(s.usuarios.COMPRAS, null, { nombre: "BERMA" })).error).toMatch(/Ya hay un proveedor/);
    expect((await guardarProveedor(s.usuarios.COMPRAS, null, { nombre: "Otro", email: "no-es-mail" })).error).toMatch(/email/);
    const [p] = await listarProveedores();
    expect(p).toMatchObject({ nombre: "Berma", cuit: "30-11111111-1", activo: true });
  });
});

describe("Compras ejecuta lo que pide Materia prima", () => {
  let pedido: number;
  let tarde: number;

  it("sin proveedor no se ejecuta; con proveedor y precio queda «pedido» con el total calculado", async () => {
    pedido = (await solicitarCompra(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: s.materiaPrima.copo2240.id, cantidadKg: 500 })).id!;
    expect((await ejecutarCompra(s.usuarios.MATERIA_PRIMA, pedido, { proveedorId: berma })).error).toMatch(/permiso/);
    expect((await ejecutarCompra(s.usuarios.COMPRAS, pedido, { proveedorId: 0 })).error).toMatch(/proveedor/);
    expect((await ejecutarCompra(s.usuarios.COMPRAS, pedido, { proveedorId: berma, fechaEntregaEstimada: sumarDias(hoy, -1) })).error).toMatch(/anterior a hoy/);
    const r = await ejecutarCompra(s.usuarios.COMPRAS, pedido, { proveedorId: berma, cantidadKg: 400, precioKg: 2000, moneda: "ARS", fechaEntregaEstimada: sumarDias(hoy, 5), numeroOc: "OC-77" });
    expect(r.error).toBeUndefined();
    const c = (await listarCompras()).find((x) => x.id === pedido)!;
    expect(c).toMatchObject({ estado: "PEDIDO", proveedor: "Berma", proveedorId: berma, cantidadKg: 400, precioKg: 2000, montoTotal: 800000, moneda: "ARS", numeroOc: "OC-77" });
    expect((await ejecutarCompra(s.usuarios.COMPRAS, pedido, { proveedorId: berma })).error).toMatch(/ya se ejecutó/);
  });

  it("los montos se pueden corregir después y quedan en el historial", async () => {
    expect((await actualizarCompra(s.usuarios.COMPRAS, pedido, { montoTotal: 820000, precioKg: null, moneda: "ARS", motivo: "flete" })).error).toBeUndefined();
    const c = (await listarCompras()).find((x) => x.id === pedido)!;
    expect(c).toMatchObject({ montoTotal: 820000, precioKg: 2050 });
    const hist = await db().select().from(schema.auditoriaConfig).where(eq(schema.auditoriaConfig.campo, "monto_total"));
    expect(hist.some((h) => h.motivo === "flete")).toBe(true);
  });

  it("cumplimiento: una entrega a tiempo y otra tarde", async () => {
    await ingresar(s.materiaPrima.copo2240.id, 400, pedido);
    // Otra compra con la entrega estimada ya vencida (se corrige la fecha a una pasada).
    tarde = (await solicitarCompra(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: s.materiaPrima.copo2240.id, cantidadKg: 100 })).id!;
    await ejecutarCompra(s.usuarios.COMPRAS, tarde, { proveedorId: berma, montoTotal: 250, moneda: "USD" });
    await actualizarCompra(s.usuarios.COMPRAS, tarde, { fechaEntregaEstimada: sumarDias(hoy, -3) });
    let c = (await listarCompras()).find((x) => x.id === tarde)!;
    expect(c).toMatchObject({ atrasada: true, diasDemora: 3 });
    await ingresar(s.materiaPrima.copo2240.id, 100, tarde);
    const compras = await listarCompras({ proveedorId: berma });
    c = compras.find((x) => x.id === tarde)!;
    expect(c).toMatchObject({ estado: "ENTREGADA", entregadaEl: hoy, diasDemora: 3 });
    expect(compras.find((x) => x.id === pedido)).toMatchObject({ estado: "ENTREGADA", diasDemora: 0 });
    const k = cumplimientoDe(compras);
    expect(k).toMatchObject({ compras: 2, entregadas: 2, medidas: 2, aTiempo: 1, demoraPromedio: 3, vencidas: 0 });
    expect(k.montos).toEqual(expect.arrayContaining([{ moneda: "ARS", total: 820000 }, { moneda: "USD", total: 250 }]));
  });

  it("si se cambia el nombre del proveedor, las compras muestran el nuevo", async () => {
    expect((await guardarProveedor(s.usuarios.COMPRAS, berma, { nombre: "Berma S.A." })).error).toBeUndefined();
    expect((await listarCompras({ proveedorId: berma })).every((c) => c.proveedor === "Berma S.A.")).toBe(true);
    // Un proveedor de baja no se puede elegir.
    await guardarProveedor(s.usuarios.COMPRAS, berma, { nombre: "Berma S.A.", activo: false });
    const otro = (await solicitarCompra(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: s.materiaPrima.copo2240.id, cantidadKg: 10 })).id!;
    expect((await ejecutarCompra(s.usuarios.COMPRAS, otro, { proveedorId: berma })).error).toMatch(/de baja/);
  });
});

describe("estado de compra en la tabla de Materia prima", () => {
  it("OK con stock de sobra; el margen del material lo pasa a «Compra próximamente»", async () => {
    const id = s.materiaPrima.copo2630.id;
    let x = (await situacionCompraMp()).get(id)!;
    expect(x).toMatchObject({ estado: "OK", comprometidoKg: 0, margenKg: 0 });
    expect((await actualizarMinMaxMateriaPrima(s.usuarios.GERENCIA, id, { minimo: null, maximo: null, avisoCompraKg: 50 })).error).toBeUndefined();
    x = (await situacionCompraMp()).get(id)!;
    expect(x).toMatchObject({ estado: "PROXIMAMENTE", margenKg: 50 });
    expect(x.sugeridoKg).toBe(Math.ceil(50 - x.libreKg));
  });
});
