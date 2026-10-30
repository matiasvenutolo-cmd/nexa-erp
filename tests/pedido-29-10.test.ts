/**
 * Pedido del cliente del 29/10/2026: orden por código de materia prima y
 * descarte de material (ej. se cayó media bolsa de master).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const { holder } = await import("./helpers/db");
  return {
    get db() {
      return holder.db;
    },
  };
});

import { abrirBase, cerrarBase, sembrar, type Semilla } from "./helpers/db";
import { compararCodigoMp, ordenTipoMp } from "@/lib/codigos-mp";
import { descartarMp, movimientosMp, stockMpPorUbicacion } from "@/lib/data/stock-mp";
import { ingresarMateriaPrima } from "@/lib/data/materia-prima";
import { getUsuarioPorEmail } from "@/lib/data/usuarios";
import * as schema from "@/lib/db/schema";
import { holder } from "./helpers/db";
import { and, eq } from "drizzle-orm";
import { codigoEtiquetaCaja, leerPartidaNexa, partidaNexa } from "@/lib/codigo-nexa";
import { crearCiclo } from "@/lib/data/produccion";
import { crearPedido } from "@/lib/data/pedidos";
import { confirmarPrimerControl, iniciarDespacho, piquear } from "@/lib/data/despachos";

let s: Semilla;

describe("orden por código de materia prima", () => {
  it("números en orden natural (ignora ceros a la izquierda), después letra + número", () => {
    const codigos = ["B10", "31", "A3", "019", "B1", "4", "P1", "3", "B2", "6"];
    expect([...codigos].sort(compararCodigoMp)).toEqual(["3", "4", "6", "019", "31", "A3", "B1", "B2", "B10", "P1"]);
  });
  it("agrupa por tipo en el orden de la planilla del cliente", () => {
    expect(["MUESTRA", "SOBRANTE", "VIRGEN", "MOLIENDA", "MASTER"].sort((a, b) => ordenTipoMp(a) - ordenTipoMp(b))).toEqual(["VIRGEN", "MASTER", "MOLIENDA", "SOBRANTE", "MUESTRA"]);
  });
});

describe("descarte de materia prima", () => {
  beforeAll(async () => {
    s = await sembrar(await abrirBase());
    await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, {
      materiaPrimaId: s.materiaPrima.copo2240.id,
      proveedor: "Proveedor",
      fechaRecepcion: "2026-10-28",
      cantidadKg: 25,
      codigoBarra: "",
      conCertificado: false,
    });
  });
  afterAll(cerrarBase);

  it("descuenta del stock con motivo, queda como «Descarte» y no deja saldo negativo", async () => {
    const id = s.materiaPrima.copo2240.id;
    const antes = (await stockMpPorUbicacion()).find((m) => m.id === id)!.deposito;
    expect((await descartarMp(s.usuarios.DESPACHO, { materiaPrimaId: id, ubicacion: "deposito", kg: 12.5, motivo: "Se cayó o se rompió la bolsa" })).error).toMatch(/permiso/);
    expect((await descartarMp(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: id, ubicacion: "deposito", kg: 12.5, motivo: "" })).error).toMatch(/motivo/);
    expect((await descartarMp(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: id, ubicacion: "deposito", kg: 12.5, motivo: "Otro" })).error).toMatch(/qué pasó/);
    expect((await descartarMp(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: id, ubicacion: "deposito", kg: 12.5, motivo: "Se cayó o se rompió la bolsa", detalle: "media bolsa" })).error).toBeUndefined();
    const despues = (await stockMpPorUbicacion()).find((m) => m.id === id)!.deposito;
    expect(despues).toBeCloseTo(antes - 12.5, 3);
    const [mov] = await movimientosMp({ materiaPrimaId: id, limite: 1 });
    expect(mov).toMatchObject({ kg: -12.5, origen: "Descarte", ubicacion: "Stock general" });
    expect(mov.motivo).toBe("Descarte: Se cayó o se rompió la bolsa — media bolsa");
    expect((await descartarMp(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: id, ubicacion: "pie", kg: 1, motivo: "Material sucio o contaminado" })).error).toMatch(/no alcanza/);
  });
});

describe("email alternativo", () => {
  beforeAll(async () => {
    s = await sembrar(await abrirBase());
  });
  afterAll(cerrarBase);

  it("la persona entra con su email principal o con el alternativo", async () => {
    const u = s.usuarios.SUPERVISOR;
    await holder.db!.update(schema.usuario).set({ email: "eduardo@nexa.com.ar", emailAlternativo: "egonzalez@cpsudamericana.com" }).where(eq(schema.usuario.id, u.id));
    expect((await getUsuarioPorEmail("eduardo@nexa.com.ar"))?.id).toBe(u.id);
    expect((await getUsuarioPorEmail(" EGonzalez@cpsudamericana.com "))?.id).toBe(u.id);
    expect(await getUsuarioPorEmail("otro@cpsudamericana.com")).toBeUndefined();
  });
});

describe("código de barras NEXA (regla del cliente 30/10/2026)", () => {
  beforeAll(async () => {
    s = await sembrar(await abrirBase());
  });
  afterAll(cerrarBase);

  it("arma el código como el ejemplo del cliente y lee la partida de 7 dígitos", () => {
    expect(codigoEtiquetaCaja("001b-ru-ne", 2026, 165, 25)).toBe("001B-RU-NE-6000165-00025");
    expect(partidaNexa(2027, 1)).toBe("7000001");
    expect(leerPartidaNexa("6000165", 2026)).toEqual({ anio: 2026, numero: 165 });
    expect(leerPartidaNexa("9000003", 2026)).toEqual({ anio: 2019, numero: 3 });
    expect(leerPartidaNexa("165", 2026)).toEqual({ anio: 2026, numero: 165 });
  });

  it("la partida es correlativa dentro del año y vuelve a empezar con el año nuevo", async () => {
    const base = { inyectora: "8", productoId: s.productos.rejNegro.id, operarioId: null, golpesInicio: 0, piezasPorGolpe: 1, cicloSegundos: null, modo: null, partidaId: null, pedidos: [], usuarioId: s.usuarios.ENCARGADO.id };
    const partidaDe = async (fecha: string) => {
      const c = await crearCiclo({ ...base, fecha });
      if ("error" in c) throw new Error(c.error);
      const [p] = await holder.db!.select({ anio: schema.partida.anio, numero: schema.partida.numero }).from(schema.partida).innerJoin(schema.cicloProduccion, eq(schema.cicloProduccion.partidaId, schema.partida.id)).where(eq(schema.cicloProduccion.id, c.id));
      // Se cierra la producción a mano para poder abrir la siguiente en la misma inyectora.
      await holder.db!.update(schema.cicloProduccion).set({ fechaFin: new Date() }).where(eq(schema.cicloProduccion.id, c.id));
      return p;
    };
    expect(await partidaDe("2026-12-30")).toEqual({ anio: 2026, numero: 1 });
    expect(await partidaDe("2026-12-31")).toEqual({ anio: 2026, numero: 2 });
    expect(await partidaDe("2027-01-02")).toEqual({ anio: 2027, numero: 1 });
  });

  it("despacho: la etiqueta compartida arma y controla cada caja una vez", async () => {
    const db = holder.db!;
    const [p] = await db.insert(schema.partida).values({ anio: 2026, numero: 165, productoId: s.productos.rejNegro.id, fechaApertura: "2026-10-30" }).returning();
    const etiqueta = codigoEtiquetaCaja("001B-RU-NE", 2026, 165, 25);
    await db.insert(schema.caja).values([1, 2].map((n) => ({ partidaId: p.id, productoId: s.productos.rejNegro.id, numeroCaja: n, cantidad: 25, codigoBarra: `P6000165-C000${n}`, codigoEtiqueta: etiqueta, fecha: "2026-10-30" })));
    const r = await crearPedido({
      clienteId: s.cliente.id, fechaPedido: "2026-10-30", fechaEntregaPactada: "2026-11-10", numeroOrden: null, contacto: null, domicilioEntrega: null, modoEntrega: null,
      requiereColocacion: false, metodoPago: null, total: null, senia: null, numeroComprobante: null, observaciones: null, usuarioId: s.usuarios.ADMINISTRACION.id,
      lineas: [{ productoId: s.productos.rejNegro.id, unidadesPedidas: 60, colorTexto: null }],
    });
    if (!("id" in r)) throw new Error(r.error);
    const d = await iniciarDespacho(s.usuarios.DESPACHO, r.id);
    expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: etiqueta.toLowerCase() })).ok).toBeDefined();
    expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: etiqueta })).ok).toBeDefined();
    expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: etiqueta })).alerta).toMatch(/ya está armada/);
    const armadas = await db.select({ cajaId: schema.piqueo.cajaId }).from(schema.piqueo).where(and(eq(schema.piqueo.despachoId, d.id!), eq(schema.piqueo.conAlerta, false)));
    expect(new Set(armadas.map((x) => x.cajaId)).size).toBe(2);
    expect((await confirmarPrimerControl(s.usuarios.DESPACHO, d.id!, "ok")).error).toBeUndefined();
    expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: etiqueta })).ok).toBeDefined();
    expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: etiqueta })).ok).toBeDefined();
    expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: etiqueta })).alerta).toMatch(/ya fue controlado/);
  });
});
