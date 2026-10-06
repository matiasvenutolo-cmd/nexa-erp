/**
 * Regresiones de la auditoría final (06/10/2026): cada caso corresponde a un
 * problema encontrado y corregido, más la matriz de permisos del servidor
 * (la capa de datos rechaza la acción aunque se llame directo, sin la UI).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@/lib/db/client", async () => {
  const h = await import("./helpers/db");
  return {
    get db() {
      return h.holder.db;
    },
  };
});

import { abrirBase, cerrarBase, holder, sembrar, type Semilla } from "./helpers/db";
import * as schema from "@/lib/db/schema";
import { asignarProductoALinea, cambiarPrioridad, cancelarPedido, crearPedido } from "@/lib/data/pedidos";
import { cerrarCiclo, crearCiclo, type FinCicloInput } from "@/lib/data/produccion";
import { ingresarMateriaPrima, retirarMateriaPrima } from "@/lib/data/materia-prima";
import {
  anularDespacho,
  confirmarControlFinal,
  confirmarPrimerControl,
  iniciarDespacho,
  piquear,
  registrarRemitoLegal,
} from "@/lib/data/despachos";
import { marcarAvisoVisto, listarAvisos } from "@/lib/data/avisos";
import { analizarReclamo, cerrarReclamo, crearReclamo, enviarInformeGerencia } from "@/lib/data/reclamos";
import { lotesConNumero, trazarLote, trazarPedido } from "@/lib/data/trazabilidad";
import { corregirStockManual } from "@/lib/data/stock";
import { actualizarMinMaxProducto } from "@/lib/data/stock-config";
import { actualizarParametro } from "@/lib/data/parametros";
import { crearDosificacion } from "@/lib/data/dosificacion";
import { crearColorEspecial } from "@/lib/data/colores";
import { crearUsuarioAdmin } from "@/lib/data/usuarios";

let s: Semilla;
const db = () => holder.db!;

async function stock(productoId: number) {
  const [f] = await db().select().from(schema.saldo).where(eq(schema.saldo.productoId, productoId));
  return Number(f?.cantidad ?? 0);
}

async function movimientosDe(productoId: number) {
  return db().select().from(schema.movimiento).where(eq(schema.movimiento.productoId, productoId));
}

async function nuevoPedido(lineas: { productoId: number; unidadesPedidas: number }[], fechaEntregaPactada = "2026-10-20") {
  const r = await crearPedido({
    clienteId: s.cliente.id,
    fechaPedido: "2026-10-06",
    fechaEntregaPactada,
    numeroOrden: null,
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
    lineas: lineas.map((l) => ({ ...l, colorTexto: null })),
  });
  if (!("id" in r)) throw new Error(r.error);
  return r.id;
}

function cierre(piezasEntregadas: number, golpesFin: number): FinCicloInput {
  return {
    golpesFin,
    piezasDescartadas: 0,
    piezasEntregadas,
    coladaKg: null,
    rebarbaKg: null,
    scrapKg: null,
    cambioCicloCausa: null,
    observaciones: null,
    cerrarPartida: false,
    usuarioId: s.usuarios.ENCARGADO.id,
  };
}

async function producir(productoId: number, piezas: number, partidaId: number | null = null) {
  const c = await crearCiclo({
    fecha: "2026-10-06",
    inyectora: "8",
    productoId,
    operarioId: null,
    golpesInicio: 0,
    piezasPorGolpe: 1,
    cicloSegundos: null,
    modo: null,
    partidaId,
    pedidos: [],
    usuarioId: s.usuarios.ENCARGADO.id,
  });
  if ("error" in c) throw new Error(c.error);
  const r = await cerrarCiclo(c.id, cierre(piezas, piezas));
  if (r.error) throw new Error(r.error);
  return c.id;
}

/** Arma, controla dos veces y entrega lo que se pase; devuelve el remito. */
async function despacharCompleto(pedidoId: number, lecturas: { codigo: string; cantidad?: number }[]) {
  const d = (await iniciarDespacho(s.usuarios.DESPACHO, pedidoId)).id!;
  for (const l of lecturas) expect((await piquear(s.usuarios.DESPACHO, d, l)).ok).toBeDefined();
  expect((await confirmarPrimerControl(s.usuarios.DESPACHO, d)).error).toBeUndefined();
  for (const l of lecturas) expect((await piquear(s.usuarios.DESPACHO, d, l)).ok).toBeDefined();
  return { despachoId: d, ...(await confirmarControlFinal(s.usuarios.DESPACHO, d)) };
}

beforeAll(async () => {
  await abrirBase();
  s = await sembrar(db());
});

afterAll(async () => {
  await cerrarBase();
});

describe("Producción: el stock y las cajas entran una sola vez", () => {
  it("cerrar dos veces el mismo ciclo (doble envío) no duplica stock ni cajas", async () => {
    const c = await crearCiclo({
      fecha: "2026-10-06",
      inyectora: "8",
      productoId: s.productos.rejRojo.id,
      operarioId: null,
      golpesInicio: 0,
      piezasPorGolpe: 1,
      cicloSegundos: null,
      modo: null,
      partidaId: null,
      pedidos: [],
      usuarioId: s.usuarios.ENCARGADO.id,
    });
    if ("error" in c) throw new Error(c.error);
    const antes = await stock(s.productos.rejRojo.id);
    const [a, b] = await Promise.all([cerrarCiclo(c.id, cierre(30, 30)), cerrarCiclo(c.id, cierre(30, 30))]);
    expect([a.error, b.error].filter(Boolean)).toEqual(["Este ciclo ya está cerrado."]);
    expect(await stock(s.productos.rejRojo.id)).toBe(antes + 30);
    expect(await db().select().from(schema.caja).where(eq(schema.caja.cicloId, c.id))).toHaveLength(2);
  });

  it("no se puede continuar una partida de otro producto ni una partida cerrada", async () => {
    const [p] = await db().select().from(schema.partida).where(eq(schema.partida.productoId, s.productos.rejRojo.id));
    const base = {
      fecha: "2026-10-06",
      inyectora: "8",
      operarioId: null,
      golpesInicio: 0,
      piezasPorGolpe: 1,
      cicloSegundos: null,
      modo: null,
      pedidos: [],
      usuarioId: s.usuarios.ENCARGADO.id,
    };
    expect(await crearCiclo({ ...base, productoId: s.productos.rejBlanco.id, partidaId: p.id })).toMatchObject({ error: /no es de este producto/ });
    await db().update(schema.partida).set({ fechaCierre: "2026-10-06" }).where(eq(schema.partida.id, p.id));
    expect(await crearCiclo({ ...base, productoId: s.productos.rejRojo.id, partidaId: p.id })).toMatchObject({ error: /ya está cerrada/ });
  });
});

describe("Despacho: el stock sale exactamente una vez", () => {
  it("dos confirmaciones del control final a la vez: un solo remito y una sola salida de stock", async () => {
    await producir(s.productos.rejNegro.id, 25);
    const [caja] = await db().select().from(schema.caja).where(eq(schema.caja.productoId, s.productos.rejNegro.id));
    const pedidoId = await nuevoPedido([{ productoId: s.productos.rejNegro.id, unidadesPedidas: 25 }]);
    const d = (await iniciarDespacho(s.usuarios.DESPACHO, pedidoId)).id!;
    await piquear(s.usuarios.DESPACHO, d, { codigo: caja.codigoBarra });
    await confirmarPrimerControl(s.usuarios.DESPACHO, d);
    await piquear(s.usuarios.DESPACHO, d, { codigo: caja.codigoBarra });
    const antes = await stock(s.productos.rejNegro.id);

    const [a, b] = await Promise.all([confirmarControlFinal(s.usuarios.DESPACHO, d), confirmarControlFinal(s.usuarios.DESPACHO, d)]);
    expect([a.remito, b.remito].filter(Boolean)).toEqual(["R-000001"]);
    expect(await stock(s.productos.rejNegro.id)).toBe(antes - 25);
    const salidas = (await movimientosDe(s.productos.rejNegro.id)).filter((m) => m.tipo === "SALIDA");
    expect(salidas).toHaveLength(1);
    expect((await iniciarDespacho(s.usuarios.DESPACHO, pedidoId)).error).toMatch(/cerrado/);
  });

  it("leer por código de producto no puede tomar unidades que están guardadas en cajas", async () => {
    await producir(s.productos.ciegoNegro.id, 30); // 25 + 5 en cajas; además hay 230 sin caja
    const sinCaja = 230;
    expect(await stock(s.productos.ciegoNegro.id)).toBe(sinCaja + 30);
    const pedidoId = await nuevoPedido([{ productoId: s.productos.ciegoNegro.id, unidadesPedidas: sinCaja + 30 }]);
    const d = (await iniciarDespacho(s.usuarios.DESPACHO, pedidoId)).id!;
    const r = await piquear(s.usuarios.DESPACHO, d, { codigo: s.productos.ciegoNegro.codigo, cantidad: sinCaja + 1 });
    expect(r.alerta).toMatch(/230 unidades libres.*30 en cajas/);
    expect((await piquear(s.usuarios.DESPACHO, d, { codigo: s.productos.ciegoNegro.codigo, cantidad: sinCaja })).ok).toBeDefined();
    // Las cajas siguen disponibles para leerlas por su código.
    const cajas = await db().select().from(schema.caja).where(eq(schema.caja.productoId, s.productos.ciegoNegro.id));
    for (const c of cajas) expect((await piquear(s.usuarios.DESPACHO, d, { codigo: c.codigoBarra })).ok).toBeDefined();
    await anularDespacho(s.usuarios.DESPACHO, d, "prueba");
  });

  it("anular un despacho ya controlado no genera movimientos, devuelve las cajas y no consume remito", async () => {
    const [caja] = await db().select().from(schema.caja).where(eq(schema.caja.productoId, s.productos.ciegoNegro.id));
    const pedidoId = await nuevoPedido([{ productoId: s.productos.ciegoNegro.id, unidadesPedidas: caja.cantidad }]);
    const movsAntes = (await movimientosDe(s.productos.ciegoNegro.id)).length;
    const d = (await iniciarDespacho(s.usuarios.DESPACHO, pedidoId)).id!;
    await piquear(s.usuarios.DESPACHO, d, { codigo: caja.codigoBarra });
    await confirmarPrimerControl(s.usuarios.DESPACHO, d);
    expect((await anularDespacho(s.usuarios.DESPACHO, d, "El cliente postergó")).error).toBeUndefined();
    expect((await movimientosDe(s.productos.ciegoNegro.id)).length).toBe(movsAntes);
    const [c] = await db().select().from(schema.caja).where(eq(schema.caja.id, caja.id));
    expect(c.estado).toBe("EN_STOCK");
    const [desp] = await db().select().from(schema.despacho).where(eq(schema.despacho.id, d));
    expect(desp.numeroInterno).toBeNull();
    // Un despacho anulado no admite el control final.
    expect((await confirmarControlFinal(s.usuarios.DESPACHO, d)).error).toBeDefined();
    const r = await despacharCompleto(pedidoId, [{ codigo: caja.codigoBarra }]);
    expect(r.remito).toBe("R-000002");
  });

  it("cancelar un pedido parcialmente entregado conserva lo entregado y libera el resto", async () => {
    const pedidoId = await nuevoPedido([{ productoId: s.productos.esqNegro.id, unidadesPedidas: 20 }]);
    await despacharCompleto(pedidoId, [{ codigo: s.productos.esqNegro.codigo, cantidad: 8 }]);
    const stockTrasEntrega = await stock(s.productos.esqNegro.id);
    expect((await cancelarPedido(s.usuarios.ADMINISTRACION, pedidoId)).error).toBeUndefined();
    expect(await stock(s.productos.esqNegro.id)).toBe(stockTrasEntrega);
    const [linea] = await db().select().from(schema.pedidoLinea).where(eq(schema.pedidoLinea.pedidoId, pedidoId));
    expect(linea.unidadesDespachadas).toBe(8);
    const [res] = await db().select().from(schema.reserva).where(eq(schema.reserva.pedidoLineaId, linea.id));
    expect(res.estado).toBe("LIBERADA");
    expect((await trazarPedido(pedidoId))!.entregas.reduce((t, e) => t + e.unidades, 0)).toBe(8);
  });
});

describe("Stock manual, reclamos y trazabilidad", () => {
  it("la corrección manual no deja el stock negativo ni acepta fracciones de pieza", async () => {
    const actual = await stock(s.productos.rejBlanco.id);
    expect((await corregirStockManual({ productoId: s.productos.rejBlanco.id, delta: -(actual + 1), motivo: "x", usuarioId: 1 })).error).toMatch(/negativo/);
    expect((await corregirStockManual({ productoId: s.productos.rejBlanco.id, delta: 1.5, motivo: "x", usuarioId: 1 })).error).toMatch(/entero/);
    expect(await stock(s.productos.rejBlanco.id)).toBe(actual);
  });

  it("un reclamo no puede apuntar a una caja que el pedido nunca recibió", async () => {
    const otroPedido = await nuevoPedido([{ productoId: s.productos.esqNegro.id, unidadesPedidas: 1 }]);
    const [cajaAjena] = await db().select().from(schema.caja).where(eq(schema.caja.productoId, s.productos.rejNegro.id));
    const r = await crearReclamo(s.usuarios.ADMINISTRACION, { pedidoId: otroPedido, descripcion: "x", cajaCodigo: cajaAjena.codigoBarra });
    expect(r.error).toMatch(/no se entregó en el pedido/);
  });

  it("un número de lote repetido entre proveedores no se resuelve al azar", async () => {
    for (const prov of ["11111111", "22222222"]) {
      const r = await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, {
        materiaPrimaId: s.materiaPrima.copo2240.id,
        proveedor: `Prov ${prov}`,
        fechaRecepcion: "2026-10-06",
        cantidadKg: 10,
        codigoBarra: `0000031${prov}000000000555`,
        conCertificado: true,
      });
      expect(r.error).toBeUndefined();
    }
    expect(await trazarLote("000000000555")).toBeNull();
    expect(await lotesConNumero("000000000555")).toHaveLength(2);
    expect((await trazarLote("000003111111111000000000555"))!.lote.proveedor).toBe("Prov 11111111");
  });
});

describe("Permisos en el servidor: la acción se rechaza aunque se llame sin la UI", () => {
  it("cada acción sensible rechaza a un rol sin permiso y no escribe nada", async () => {
    const pedidoId = await nuevoPedido([{ productoId: s.productos.rejBlanco.id, unidadesPedidas: 1 }]);
    const [linea] = await db().select().from(schema.pedidoLinea).where(eq(schema.pedidoLinea.pedidoId, pedidoId));
    const [desp] = await db().select().from(schema.despacho).where(eq(schema.despacho.estado, "ENTREGADO")).limit(1);
    const op = s.usuarios.OPERARIO;
    const movsAntes = (await db().select().from(schema.movimiento)).length;
    const auditAntes = (await db().select().from(schema.auditoriaConfig)).length;

    const intentos: [string, () => Promise<{ error?: string }>][] = [
      ["iniciar despacho", () => iniciarDespacho(op, pedidoId)],
      ["piquear", () => piquear(op, desp.id, { codigo: "x" })],
      ["primer control", () => confirmarPrimerControl(op, desp.id)],
      ["control final", () => confirmarControlFinal(op, desp.id)],
      ["anular despacho", () => anularDespacho(op, desp.id, "x")],
      ["remito legal (despacho)", () => registrarRemitoLegal(s.usuarios.DESPACHO, desp.id, "1")],
      ["ingreso MP", () => ingresarMateriaPrima(op, { materiaPrimaId: 1, proveedor: "x", fechaRecepcion: "2026-10-06", cantidadKg: 1, codigoBarra: "0".repeat(27), conCertificado: false })],
      ["retiro MP", () => retirarMateriaPrima(op, { materiaPrimaId: 1, loteMpId: null, cantidadKg: 1, inyectora: null, cicloId: null, entregaId: null, observaciones: null })],
      ["crear reclamo", () => crearReclamo(op, { pedidoId, descripcion: "x" })],
      ["analizar reclamo (encargado)", () => analizarReclamo(s.usuarios.ENCARGADO, 1, { causa: "x" })],
      ["cerrar reclamo (gerencia)", () => cerrarReclamo(s.usuarios.GERENCIA, 1)],
      ["informe a gerencia (administración)", () => enviarInformeGerencia(s.usuarios.ADMINISTRACION, 1)],
      ["prioridad (administración)", () => cambiarPrioridad(s.usuarios.ADMINISTRACION, pedidoId, -2, "Urgencia")],
      ["prioridad (gerencia)", () => cambiarPrioridad(s.usuarios.GERENCIA, pedidoId, -2, "Urgencia")],
      ["cancelar pedido", () => cancelarPedido(op, pedidoId)],
      ["asignar producto", () => asignarProductoALinea(op, linea.id, s.productos.rejRojo.id)],
      ["mín/máx (supervisor)", () => actualizarMinMaxProducto(s.usuarios.SUPERVISOR, s.productos.rejBlanco.id, { minimo: 1, maximo: 2, motivo: "x" })],
      ["parámetro (administración)", () => actualizarParametro(s.usuarios.ADMINISTRACION, "unidades_por_caja_pisos", 30, "x")],
      ["master (administración)", () => crearDosificacion(s.usuarios.ADMINISTRACION, { familia: "CIEGO", colorId: s.colores.rojo.id, materiaPrimaBaseId: null, gPorKgMp: 1, observaciones: null, motivo: "x" })],
      ["color especial", () => crearColorEspecial(op, { nombre: "Verde Prueba", clienteId: null, proveedorMasterId: null, masterNombre: null, masterCodigo: null, masterMateriaPrimaId: null, observaciones: null })],
      ["usuarios (encargado)", () => crearUsuarioAdmin(s.usuarios.ENCARGADO, { nombre: "x", email: "x@x", rol: "GERENCIA", secreto: "12345678" })],
    ];
    for (const [nombre, intento] of intentos) {
      const r = await intento();
      expect(r.error, nombre).toBeDefined();
    }
    const [aviso] = await listarAvisos("ADMINISTRACION");
    expect((await marcarAvisoVisto(s.usuarios.DESPACHO, aviso.id)).error).toBeDefined();

    expect((await db().select().from(schema.movimiento)).length).toBe(movsAntes);
    expect((await db().select().from(schema.auditoriaConfig)).length).toBe(auditAntes);
    const [p] = await db().select().from(schema.pedido).where(eq(schema.pedido.id, pedidoId));
    expect(p).toMatchObject({ estado: "PEDIDO", prioridad: 0 });
  });

  it("Encargado y Supervisor sí cambian la prioridad, con auditoría, y la cola respeta la fecha", async () => {
    const tarde = await nuevoPedido([{ productoId: s.productos.rejRojo.id, unidadesPedidas: 5000 }], "2026-12-30");
    const pronto = await nuevoPedido([{ productoId: s.productos.rejRojo.id, unidadesPedidas: 5000 }], "2026-10-10");
    const { colaProduccion } = await import("@/lib/data/produccion");
    const orden = async () => (await colaProduccion()).find((f) => f.productoId === s.productos.rejRojo.id)!.pedidos.map((p) => p.pedidoId);
    let o = await orden();
    expect(o.indexOf(pronto)).toBeLessThan(o.indexOf(tarde));
    expect((await cambiarPrioridad(s.usuarios.SUPERVISOR, tarde, -2, "Urgencia", "cliente en obra")).error).toBeUndefined();
    o = await orden();
    expect(o.indexOf(tarde)).toBeLessThan(o.indexOf(pronto));
    const audit = await db().select().from(schema.auditoriaConfig).where(eq(schema.auditoriaConfig.campo, "prioridad"));
    expect(audit.at(-1)).toMatchObject({ entidadId: String(tarde), valorNuevo: "Urgente", motivo: "Urgencia — cliente en obra", usuarioId: s.usuarios.SUPERVISOR.id });
  });
});

describe("Fechas en hora argentina", () => {
  it("a las 22:30 del 5/10 en Buenos Aires, hoy sigue siendo el 5/10 (no el 6 de UTC)", async () => {
    const { hoyISO, fmtDia, fmtFecha } = await import("@/lib/format");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T01:30:00Z"));
    try {
      expect(hoyISO()).toBe("2026-10-05");
      expect(fmtDia(new Date())).toBe("05/10/2026");
      expect(fmtFecha("2026-10-05")).toBe("05/10/2026"); // columnas date: sin corrimiento
    } finally {
      vi.useRealTimers();
    }
  });
});
