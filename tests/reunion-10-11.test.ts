/**
 * Reunión 10/11/2026 con NEXA: planificación (fechas pasadas, orden dentro del
 * turno, cambio de matriz automático) y código de caja corto.
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
import { actualizarTanda, cancelarTanda, crearTanda, dividirTanda, listarTandas, moverTanda, necesidadDeCompra } from "@/lib/data/planificacion";
import { guardarReceta, listarPresentaciones } from "@/lib/data/recetas";
import { actualizarCompra, calcularNecesidad, comprasSolicitadas, pendientePorMp, solicitarCompra } from "@/lib/data/compras";
import { listarAvisos } from "@/lib/data/avisos";
import { crearPedido, editarLineasPedido } from "@/lib/data/pedidos";
import { hoyISO } from "@/lib/format";
import { yaPaso } from "@/lib/turnos";
import { PATRONES, anchosCode128, valoresCode128B } from "@/lib/code128";

let s: Semilla;
const db = () => holder.db!;
const hoy = hoyISO();
const cambiosDe = (tandaId: number) =>
  db().select().from(schema.intervencionMatriz).where(and(eq(schema.intervencionMatriz.tandaId, tandaId), eq(schema.intervencionMatriz.tipo, "CAMBIO_MATRIZ")));

beforeAll(async () => {
  s = await sembrar(await abrirBase());
});
afterAll(cerrarBase);

describe("fechas pasadas", () => {
  it("un día anterior no se puede planificar; la noche de hoy sí", () => {
    expect(yaPaso("2026-01-01", "MANANA", new Date("2026-11-14T15:00:00Z"))).toBe(true);
    expect(yaPaso("2026-11-14", "MANANA", new Date("2026-11-14T21:00:00Z"))).toBe(true); // 18 h en Buenos Aires
    expect(yaPaso("2026-11-14", "NOCHE", new Date("2026-11-14T21:00:00Z"))).toBe(false);
    // A las 3 de la mañana sigue la noche de ayer.
    expect(yaPaso("2026-11-13", "NOCHE", new Date("2026-11-14T06:00:00Z"))).toBe(false);
  });
});

describe("cambio de matriz automático y orden dentro del turno", () => {
  let rejilla: number;
  let ciego: number;
  let rejilla2: number;

  it("al poner un ciego después de una rejilla en la misma máquina se programa el cambio de matriz", async () => {
    rejilla = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejNegro.id, lineas: [], cantidadStock: 40 })).id!;
    ciego = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.ciegoNegro.id, lineas: [], cantidadStock: 40 })).id!;
    expect((await actualizarTanda(s.usuarios.ENCARGADO, rejilla, { fecha: "2026-01-01", turno: "MANANA" })).error).toMatch(/ya pasó/);
    await actualizarTanda(s.usuarios.ENCARGADO, rejilla, { fecha: hoy, turno: "NOCHE" });
    await actualizarTanda(s.usuarios.ENCARGADO, ciego, { fecha: hoy, turno: "NOCHE" });
    const [c] = await cambiosDe(ciego);
    expect(c).toMatchObject({ estado: "PROGRAMADA", inyectora: "8", fechaProgramada: hoy, turno: "NOCHE", matrizAnterior: "Rejilla" });
    expect(await cambiosDe(rejilla)).toHaveLength(0);
  });

  it("dentro del turno se ordena con ↑ ↓ y el cambio de matriz pasa a la que queda segunda", async () => {
    await moverTanda(s.usuarios.ENCARGADO, ciego, "arriba");
    const orden = (await listarTandas()).filter((t) => [rejilla, ciego].includes(t.id)).map((t) => t.id);
    expect(orden).toEqual([ciego, rejilla]);
    expect((await cambiosDe(ciego)).find((c) => c.estado === "PROGRAMADA")).toBeUndefined();
    expect((await cambiosDe(rejilla))[0]).toMatchObject({ estado: "PROGRAMADA", matriz: "Rejilla" });
  });

  it("si la tanda se cancela, su cambio de matriz se cancela", async () => {
    rejilla2 = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejRojo.id, lineas: [], cantidadStock: 10, fecha: hoy, turno: "NOCHE" })).id!;
    await cancelarTanda(s.usuarios.ENCARGADO, rejilla, "prueba");
    expect((await cambiosDe(rejilla))[0].estado).toBe("CANCELADA");
    // Ahora la rejilla roja sigue al ciego: pide cambio de matriz.
    expect((await cambiosDe(rejilla2))[0]).toMatchObject({ estado: "PROGRAMADA", matrizAnterior: expect.stringMatching(/^Ciego/) });
  });
});

describe("duración de las tandas y capacidad del turno", () => {
  it("una tanda que no entra en el turno se rechaza y se puede dividir", async () => {
    // Tiempos del Excel de Eduardo para el piso rejilla: 40 piezas por hora, 2:30 h de set-up.
    await db().update(schema.producto).set({ piezasPorHora: 40, setupHoras: "2.5" }).where(eq(schema.producto.id, s.productos.rejBlanco.id));
    const id = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejBlanco.id, lineas: [], cantidadStock: 454 })).id!;
    const [v] = (await listarTandas()).filter((t) => t.id === id);
    expect(v).toMatchObject({ duracionHoras: 13.85, conSetup: true }); // 2,5 + 454 ÷ 40
    const r = await actualizarTanda(s.usuarios.ENCARGADO, id, { fecha: hoy, turno: "NOCHE", inyectora: "8" });
    expect(r.error).toMatch(/No entra en el turno/);
    // Con lo que ya hay en ese turno de la 8 (sin tiempos cargados), entran 6,5 h × 40 = 260 piezas.
    expect(r.dividir).toBe(260);
    const d = await dividirTanda(s.usuarios.ENCARGADO, id, 260);
    expect(d.error).toBeUndefined();
    expect((await actualizarTanda(s.usuarios.ENCARGADO, id, { fecha: hoy, turno: "NOCHE", inyectora: "8" })).error).toBeUndefined();
    const [resto] = await db().select().from(schema.tanda).where(eq(schema.tanda.id, d.nuevaId!));
    expect(resto).toMatchObject({ cantidadStock: 194, fecha: null, inyectora: "8" });
    // La segunda parte sigue al mismo producto: no lleva set-up.
    expect((await listarTandas()).find((t) => t.id === d.nuevaId)).toMatchObject({ conSetup: false, duracionHoras: 4.85 });
  });
});

describe("compras: faltantes, tres necesidades y pedido de Materia prima", () => {
  it("con más demanda que stock, Producción → Compras muestra el faltante y Compras lo separa por destino", async () => {
    const pres = await listarPresentaciones();
    const bolsa = pres.find((p) => p.nombre === "Bolsa 25 kg" && p.tipoMp === "VIRGEN")!;
    expect((await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejRojo.id, "REGIMEN", { items: [{ materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa.id, cantidad: 1 }] })).error).toBeUndefined();
    // 20.000 pisos × 0,61 kg = 12.200 kg; hay 6.975 kg de 2240 P.
    await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejRojo.id, lineas: [], cantidadStock: 20000 });
    const nec = await necesidadDeCompra();
    const copo = nec.find((m) => m.materiaPrimaId === s.materiaPrima.copo2240.id)!;
    expect(copo.faltanteKg).toBeGreaterThan(0);
    const n = await calcularNecesidad();
    const f = n.filas.find((x) => x.materiaPrimaId === s.materiaPrima.copo2240.id)!;
    // La tanda es para stock (sin pedidos): su material cuenta como pedido planificado.
    expect(f.paraPedidosKg + f.paraStockPisosKg + f.paraMinimoMpKg).toBeCloseTo(f.proyectadaKg, 3);
    expect(f.proyectadaKg).toBeGreaterThan(0);
  });

  it("Materia prima pide a Compras: queda «pedida por Materia prima» con aviso, y Compras la activa", async () => {
    expect((await solicitarCompra(s.usuarios.DESPACHO, { materiaPrimaId: s.materiaPrima.copo2240.id, cantidadKg: 500 })).error).toMatch(/Materia prima/);
    const r = await solicitarCompra(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: s.materiaPrima.copo2240.id, cantidadKg: 500, observaciones: "para la semana" });
    expect(r.error).toBeUndefined();
    expect(await comprasSolicitadas()).toMatchObject([{ id: r.id, estado: "SOLICITADA", cantidadKg: 500 }]);
    expect((await listarAvisos("COMPRAS"))[0]).toMatchObject({ tipo: "PEDIDO_MATERIA_PRIMA" });
    // No cuenta como comprado hasta que Compras la activa.
    expect((await pendientePorMp()).get(s.materiaPrima.copo2240.id) ?? 0).toBe(0);
    expect((await actualizarCompra(s.usuarios.COMPRAS, r.id!, { estado: "PEDIDO" })).error).toBeUndefined();
    expect((await pendientePorMp()).get(s.materiaPrima.copo2240.id)).toBe(500);
  });
});

describe("código de barras de la etiqueta (Code 128)", () => {
  it("la tabla de patrones es válida: cada uno suma 11 módulos (el stop 13) y no se repiten", () => {
    expect(PATRONES).toHaveLength(107);
    PATRONES.forEach((p, i) => expect([...p].reduce((t, n) => t + Number(n), 0)).toBe(i === 106 ? 13 : 11));
    expect(new Set(PATRONES).size).toBe(107);
  });
  it("codifica el código NEXA con su dígito verificador", () => {
    // «A» en el juego B: inicio 104, valor 33, verificador (104 + 33) % 103 = 34.
    expect(valoresCode128B("A")).toEqual([104, 33, 34, 106]);
    const v = valoresCode128B("001B-6000172-00022");
    expect(v[0]).toBe(104);
    expect(v.at(-1)).toBe(106);
    expect(anchosCode128("001B-6000172-00022").reduce((t, n) => t + n, 0)).toBe(11 * (v.length - 1) + 13);
  });
});

describe("editar los productos de un pedido", () => {
  it("se agrega un color, se cambia y se quita una cantidad; ajusta reservas y tandas y avisa a Administración y al Encargado", async () => {
    const r = await crearPedido({
      clienteId: s.cliente.id, fechaPedido: hoy, fechaEntregaPactada: null, numeroOrden: "E-1", contacto: null, domicilioEntrega: null, modoEntrega: null,
      requiereColocacion: false, metodoPago: null, total: null, senia: null, numeroComprobante: null, observaciones: null, usuarioId: s.usuarios.ADMINISTRACION.id,
      lineas: [{ productoId: s.productos.rejNegro.id, unidadesPedidas: 100, colorTexto: null }],
    });
    if (!("id" in r)) throw new Error(r.error);
    const [linea] = await db().select().from(schema.pedidoLinea).where(eq(schema.pedidoLinea.pedidoId, r.id));
    // Planificada en una tanda.
    const t = await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejNegro.id, lineas: [{ pedidoLineaId: linea.id, cantidad: 100 }] });
    expect((await editarLineasPedido(s.usuarios.OPERARIO, r.id, [{ lineaId: linea.id, unidades: 60 }])).error).toMatch(/permiso/);
    expect((await editarLineasPedido(s.usuarios.ADMINISTRACION, r.id, [{ lineaId: linea.id, unidades: 60 }, { productoId: s.productos.rejBlanco.id, unidades: 30 }], "El cliente sumó blanco")).error).toBeUndefined();
    const lineas = await db().select().from(schema.pedidoLinea).where(eq(schema.pedidoLinea.pedidoId, r.id));
    expect(lineas.map((l) => l.unidadesPedidas).sort((a, b) => a - b)).toEqual([30, 60]);
    const [res] = await db().select().from(schema.reserva).where(and(eq(schema.reserva.pedidoLineaId, linea.id), eq(schema.reserva.estado, "ABIERTA")));
    expect(Number(res.cantidad)).toBe(60);
    const [td] = await db().select().from(schema.tanda).where(eq(schema.tanda.id, t.id!));
    expect(td.cantidadPedidos).toBe(60);
    expect((await listarAvisos("ADMINISTRACION")).some((a) => a.tipo === "PEDIDO_MODIFICADO" && a.pedidoId === r.id)).toBe(true);
    expect((await listarAvisos("ENCARGADO")).some((a) => a.tipo === "PEDIDO_MODIFICADO" && a.pedidoId === r.id)).toBe(true);
    // Quitar el blanco.
    const blanco = lineas.find((l) => l.productoId === s.productos.rejBlanco.id)!;
    expect((await editarLineasPedido(s.usuarios.ADMINISTRACION, r.id, [{ lineaId: blanco.id, unidades: 0 }])).error).toBeUndefined();
    expect(await db().select().from(schema.pedidoLinea).where(eq(schema.pedidoLinea.pedidoId, r.id))).toHaveLength(1);
    // Con algo entregado ya no se cambia.
    await db().update(schema.pedidoLinea).set({ unidadesDespachadas: 10 }).where(eq(schema.pedidoLinea.id, linea.id));
    expect((await editarLineasPedido(s.usuarios.ADMINISTRACION, r.id, [{ lineaId: linea.id, unidades: 80 }])).error).toMatch(/pedido nuevo/);
  });
});
