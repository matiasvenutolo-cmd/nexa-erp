/**
 * Minuta 15/10/2026 — correcciones de pedidos y variantes de materia prima:
 * estado del pedido derivado de lo realmente entregado, archivado reversible,
 * aviso de error para corregir, ajustes de balanza, molienda en bolsones,
 * fraccionamiento de master, alta de materiales y alerta de cantidades.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

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
import { archivarPedido, cancelarPedido, crearPedido, listarPedidos, coberturaPorLinea } from "@/lib/data/pedidos";
import { confirmarControlFinal, confirmarPrimerControl, iniciarDespacho, piquear, recalcularEstadoPedido } from "@/lib/data/despachos";
import { informarError, listarAvisos } from "@/lib/data/avisos";
import { ajustarStockMp, alertaCantidad, altaMateriaPrima, fraccionarMaster, ingresarBolsonMolienda, movimientosMp, stockMpPorUbicacion } from "@/lib/data/stock-mp";
import { ingresarMateriaPrima } from "@/lib/data/materia-prima";
import { listarPresentaciones } from "@/lib/data/recetas";
import { listarAuditoria } from "@/lib/data/auditoria";

let s: Semilla;
const db = () => holder.db!;

async function nuevoPedido(productoId: number, unidades: number, numeroOrden: string | null = null) {
  const r = await crearPedido({
    clienteId: s.cliente.id,
    numeroOrden,
    fechaPedido: "2026-10-10",
    fechaEntregaPactada: null,
    contacto: null,
    domicilioEntrega: null,
    modoEntrega: null,
    requiereColocacion: false,
    metodoPago: null,
    total: null,
    senia: null,
    numeroComprobante: null,
    observaciones: null,
    usuarioId: s.usuarios.ADMINISTRACION.id,
    lineas: [{ productoId, colorTexto: null, unidadesPedidas: unidades }],
  });
  return r;
}
async function estado(id: number) {
  const [p] = await db().select({ estado: schema.pedido.estado }).from(schema.pedido).where(eq(schema.pedido.id, id));
  return p.estado;
}

beforeAll(async () => {
  await abrirBase();
  s = await sembrar(db());
});
afterAll(async () => {
  await cerrarBase();
});

describe("Pedidos: estados derivados de lo entregado (bug de la demo)", () => {
  it("entrega parcial y después completa: Entregado no vuelve atrás", async () => {
    const r = await nuevoPedido(s.productos.esqNegro.id, 20);
    if (!("id" in r)) throw new Error(r.error);
    const entregar = async (cantidad: number) => {
      const d = await iniciarDespacho(s.usuarios.DESPACHO, r.id);
      expect(d.error).toBeUndefined();
      expect(await estado(r.id)).toBe("EN_ARMADO");
      expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: s.productos.esqNegro.codigo, cantidad })).ok).toBeDefined();
      expect((await confirmarPrimerControl(s.usuarios.DESPACHO, d.id!, "ok")).error).toBeUndefined();
      expect(await estado(r.id)).toBe("LISTO_PARA_DESPACHAR");
      expect((await piquear(s.usuarios.ENCARGADO, d.id!, { codigo: s.productos.esqNegro.codigo, cantidad })).ok).toBeDefined();
      expect((await confirmarControlFinal(s.usuarios.ENCARGADO, d.id!, "ok")).error).toBeUndefined();
    };
    await entregar(10);
    expect(await estado(r.id)).toBe("PARCIALMENTE_DESPACHADO");
    await entregar(10);
    expect(await estado(r.id)).toBe("ENTREGADO");
    expect((await iniciarDespacho(s.usuarios.DESPACHO, r.id)).error).toMatch(/cerrado/);
    await recalcularEstadoPedido(db() as never, r.id);
    expect(await estado(r.id)).toBe("ENTREGADO");
  });

  it("un N° de orden repetido se informa en vez de romper la pantalla", async () => {
    expect("id" in (await nuevoPedido(s.productos.rejBlanco.id, 5, "OC-123"))).toBe(true);
    const dup = await nuevoPedido(s.productos.rejBlanco.id, 5, "OC-123");
    expect("error" in dup && dup.error).toMatch(/Ya existe el pedido/);
  });
});

describe("Archivado reversible", () => {
  it("sólo Supervisión o Gerencia; no se archiva un pedido abierto con stock reservado", async () => {
    const r = await nuevoPedido(s.productos.rejRojo.id, 3);
    if (!("id" in r)) throw new Error(r.error);
    expect((await archivarPedido(s.usuarios.ADMINISTRACION, r.id, "prueba")).error).toMatch(/Supervisión o Gerencia/);
    expect((await archivarPedido(s.usuarios.SUPERVISOR, r.id, "prueba")).error).toMatch(/reservado/);
    await cancelarPedido(s.usuarios.SUPERVISOR, r.id);
    expect((await archivarPedido(s.usuarios.SUPERVISOR, r.id, null)).error).toMatch(/motivo/);
    expect((await archivarPedido(s.usuarios.SUPERVISOR, r.id, "Dato de prueba de la demo")).error).toBeUndefined();
    expect((await listarPedidos()).some((p) => p.id === r.id)).toBe(false);
    expect((await listarPedidos(undefined, { archivados: true })).some((p) => p.id === r.id)).toBe(true);
    expect((await archivarPedido(s.usuarios.GERENCIA, r.id, null, true)).error).toBeUndefined();
    expect((await listarPedidos()).some((p) => p.id === r.id)).toBe(true);
    const h = await listarAuditoria({ entidad: "pedido", entidadId: r.id });
    expect(h.filter((x) => x.campo === "archivado")).toHaveLength(2);
  });

  it("un pedido archivado no cuenta para la cobertura ni la planificación", async () => {
    const r = await nuevoPedido(s.productos.ciegoNegro.id, 7);
    if (!("id" in r)) throw new Error(r.error);
    await db().update(schema.pedido).set({ archivado: true }).where(eq(schema.pedido.id, r.id));
    const [l] = await db().select().from(schema.pedidoLinea).where(eq(schema.pedidoLinea.pedidoId, r.id));
    expect((await coberturaPorLinea()).has(l.id)).toBe(false);
  });
});

describe("Informar un error", () => {
  it("llega a Supervisión con la pantalla de origen", async () => {
    expect((await informarError(s.usuarios.MATERIA_PRIMA, { descripcion: "", pantalla: "/materia-prima" })).error).toBeDefined();
    expect((await informarError(s.usuarios.MATERIA_PRIMA, { descripcion: "Cargué 4,5 kg y eran 4.500 kg", pantalla: "/materia-prima/ingreso" })).error).toBeUndefined();
    const avisos = await listarAvisos("SUPERVISOR");
    expect(avisos[0]).toMatchObject({ tipo: "ERROR_INFORMADO", mensaje: expect.stringContaining("4.500 kg") });
  });
});

describe("Materia prima: variantes del Excel", () => {
  it("alerta (sin bloquear) cantidades fuera de rango: 1,5 en vez de 1.500", async () => {
    expect(await alertaCantidad(s.materiaPrima.copo2240.id, 1.5)).toMatch(/menos de una bolsa/);
    for (const [i, kg] of [1500, 1500, 1250].entries()) {
      await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, {
        materiaPrimaId: s.materiaPrima.copo2240.id,
        proveedor: "INDARNYL",
        fechaRecepcion: "2026-10-12",
        cantidadKg: kg,
        codigoBarra: `0000031${"12345678"}${String(900 + i).padStart(12, "0")}`,
        conCertificado: false,
      });
    }
    expect(await alertaCantidad(s.materiaPrima.copo2240.id, 1.5)).toMatch(/suelen ser/);
    expect(await alertaCantidad(s.materiaPrima.copo2240.id, 1500)).toBeNull();
  });

  it("diferencia de balanza: ajuste autorizado de Materia prima, con motivo y en los movimientos", async () => {
    const antes = (await stockMpPorUbicacion()).find((m) => m.id === s.materiaPrima.copo2240.id)!.deposito;
    expect((await ajustarStockMp(s.usuarios.DESPACHO, { materiaPrimaId: s.materiaPrima.copo2240.id, ubicacion: "deposito", deltaKg: -0.35, motivo: "x" })).error).toMatch(/permiso/);
    expect((await ajustarStockMp(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: s.materiaPrima.copo2240.id, ubicacion: "deposito", deltaKg: -0.35, motivo: "Diferencia de balanza al terminar una bolsa" })).error).toBeUndefined();
    const despues = (await stockMpPorUbicacion()).find((m) => m.id === s.materiaPrima.copo2240.id)!.deposito;
    expect(despues).toBeCloseTo(antes - 0.35, 3);
    const [mov] = await movimientosMp({ materiaPrimaId: s.materiaPrima.copo2240.id, limite: 1 });
    expect(mov).toMatchObject({ kg: -0.35, origen: "Diferencia de balanza", ubicacion: "Depósito" });
    // A pie de máquina no hay nada: no puede quedar negativo.
    expect((await ajustarStockMp(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: s.materiaPrima.copo2240.id, ubicacion: "pie", deltaKg: -1, motivo: "Faltante justificado" })).error).toMatch(/no alcanza/);
  });

  it("alta de material: Supervisión o Gerencia; un sobrante con master se identifica como tal", async () => {
    expect((await altaMateriaPrima(s.usuarios.MATERIA_PRIMA, { codigoInterno: "411", nombre: "411-PP con master negro", tipo: "SOBRANTE" })).error).toMatch(/Supervisión o Gerencia/);
    const r = await altaMateriaPrima(s.usuarios.SUPERVISOR, { codigoInterno: "411", nombre: "411-PP con master negro", tipo: "SOBRANTE", motivo: "Bajado de tolva por urgencia" });
    expect(r.error).toBeUndefined();
    expect((await altaMateriaPrima(s.usuarios.GERENCIA, { codigoInterno: "411", nombre: "otro", tipo: "SOBRANTE" })).error).toMatch(/Ya existe/);
    // Molienda/sobrante en bolsones de peso variable, cada uno con su código.
    const b1 = await ingresarBolsonMolienda(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: r.id!, kg: 312.4 });
    const b2 = await ingresarBolsonMolienda(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: r.id!, kg: 287.15 });
    expect(b1.codigo).toBe("000041199999999000000000001");
    expect(b2.codigo).toBe("000041199999999000000000002");
    expect((await stockMpPorUbicacion()).find((m) => m.id === r.id)!.deposito).toBeCloseTo(599.55, 3);
    const lotes = await db().select().from(schema.loteMp).where(eq(schema.loteMp.materiaPrimaId, r.id!));
    expect(lotes).toHaveLength(2);
  });

  it("fraccionamiento de master: queda registrado sin cambiar los kilos; no supera lo que hay", async () => {
    const [master] = await db().insert(schema.materiaPrima).values({ codigoInterno: "24", nombre: "24-Master negro 951", tipo: "MASTER" }).returning();
    await db().insert(schema.saldo).values({ depositoId: s.deposito.id, materiaPrimaId: master.id, cantidad: "5" });
    const b600 = (await listarPresentaciones()).find((p) => p.nombre === "Bolsita 600 g")!;
    expect((await fraccionarMaster(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: master.id, presentacionId: b600.id, cantidad: 9 })).error).toMatch(/no alcanza/);
    expect((await fraccionarMaster(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: master.id, presentacionId: b600.id, cantidad: 8 })).error).toBeUndefined();
    const [sal] = await db().select().from(schema.saldo).where(and(eq(schema.saldo.materiaPrimaId, master.id), eq(schema.saldo.depositoId, s.deposito.id)));
    expect(Number(sal.cantidad)).toBe(5);
    const [f] = await db().select().from(schema.fraccionamientoMp);
    expect(f).toMatchObject({ cantidad: 8, kgTotal: "4.800" });
  });
});
