/**
 * Listado de mejoras del 7/11/2026: conteo físico semanal de materia prima,
 * pedido listo para despachar en parte y limpieza del inyector.
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
import { conteosMp, planillaConteo, registrarConteoMp, stockMpALaFecha } from "@/lib/data/conteo-mp";
import { ingresarMateriaPrima } from "@/lib/data/materia-prima";
import { crearPedido, listarPedidos } from "@/lib/data/pedidos";
import { crearTanda, iniciarProduccionDeTanda } from "@/lib/data/planificacion";
import { registrarRetiroMaquina } from "@/lib/data/maquina";
import { MOTIVO_LIMPIEZA, registrarLimpieza, tomarTurno } from "@/lib/data/taller";
import { hoyISO, sumarDias } from "@/lib/format";

let s: Semilla;
const db = () => holder.db!;
const hoy = hoyISO();

async function saldo(mpId: number, depositoId: number) {
  const [f] = await db().select().from(schema.saldo).where(and(eq(schema.saldo.materiaPrimaId, mpId), eq(schema.saldo.depositoId, depositoId)));
  return Number(f?.cantidad ?? 0);
}

beforeAll(async () => {
  s = await sembrar(await abrirBase());
});
afterAll(cerrarBase);

describe("conteo físico semanal de materia prima", () => {
  let mp: number;

  it("el stock teórico a la fecha sale de los movimientos", async () => {
    mp = s.materiaPrima.copo2630.id;
    const r = await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: mp, proveedor: "Prov", fechaRecepcion: hoy, cantidadKg: 100, codigoBarra: "000000312345678000000000777", conCertificado: false });
    expect(r.error).toBeUndefined();
    expect((await stockMpALaFecha(hoy)).get(mp)).toBe(100);
    expect((await stockMpALaFecha(sumarDias(hoy, -1))).get(mp)).toBeUndefined();
    expect((await planillaConteo(hoy)).find((f) => f.id === mp)).toMatchObject({ teorico: 100 });
  });

  it("con diferencia exige justificación; sólo lo carga Materia prima o el Encargado", async () => {
    expect((await registrarConteoMp(s.usuarios.OPERARIO, { fecha: hoy, lineas: [{ materiaPrimaId: mp, contado: 98 }] })).error).toMatch(/Materia prima o el Encargado/);
    expect((await registrarConteoMp(s.usuarios.MATERIA_PRIMA, { fecha: hoy, lineas: [] })).error).toMatch(/al menos un material/);
    expect((await registrarConteoMp(s.usuarios.MATERIA_PRIMA, { fecha: hoy, lineas: [{ materiaPrimaId: mp, contado: 98 }] })).error).toMatch(/Justificá/);
  });

  it("sin ajustar, queda el comparativo y el stock no se toca", async () => {
    const r = await registrarConteoMp(s.usuarios.MATERIA_PRIMA, { fecha: hoy, lineas: [{ materiaPrimaId: mp, contado: 98, motivo: "Bolsa rota" }] });
    expect(r).toMatchObject({ diferencias: 1 });
    expect(await saldo(mp, s.deposito.id)).toBe(100);
    const [c] = await conteosMp();
    expect(c.lineas[0]).toMatchObject({ sistema: 100, contado: 98, diferencia: -2, motivo: "Bolsa rota" });
  });

  it("ajustando, el stock queda igual a lo contado con un movimiento de inventario; un doble envío no se repite", async () => {
    const input = { fecha: hoy, lineas: [{ materiaPrimaId: mp, contado: 97.5, motivo: "Bolsa rota y derrame" }], ajustar: true };
    const r = await registrarConteoMp(s.usuarios.ENCARGADO, input);
    expect(r.error).toBeUndefined();
    const otra = await registrarConteoMp(s.usuarios.ENCARGADO, input);
    expect(otra.id).toBe(r.id);
    expect(await saldo(mp, s.deposito.id)).toBe(97.5);
    const movs = await db().select().from(schema.movimiento).where(and(eq(schema.movimiento.origen, "INVENTARIO"), eq(schema.movimiento.origenId, r.id!)));
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ tipo: "AJUSTE", cantidad: "-2.500" });
    expect((await stockMpALaFecha(hoy)).get(mp)).toBe(97.5);
    expect(await conteosMp()).toHaveLength(2);
  });
});

describe("pedido listo en parte", () => {
  it("marca «parcial» cuando lo armado no cubre lo pedido", async () => {
    const r = await crearPedido({
      clienteId: s.cliente.id,
      numeroOrden: null,
      fechaPedido: hoy,
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
      lineas: [{ productoId: s.productos.rejBlanco.id, colorTexto: null, unidadesPedidas: 100 }],
    });
    if (!("id" in r)) throw new Error(r.error);
    const fila = async () => (await listarPedidos()).find((p) => p.id === r.id)!;
    expect((await fila()).parcial).toBe(true);
    await db().update(schema.pedidoLinea).set({ unidadesArmadas: 100 }).where(eq(schema.pedidoLinea.pedidoId, r.id));
    expect((await fila()).parcial).toBe(false);
  });
});

describe("limpieza del inyector", () => {
  it("sale del pie de máquina a la tolva y queda como novedad «Limpieza del inyector»", async () => {
    const t = await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejRojo.id, lineas: [], cantidadStock: 40, fecha: hoy, turno: "NOCHE" });
    expect(t.error).toBeUndefined();
    const ini = await iniciarProduccionDeTanda(s.usuarios.ENCARGADO, t.id!, { golpesInicio: 0 });
    expect(ini.error).toBeUndefined();
    const cicloId = ini.cicloId!;
    const deps = await db().select().from(schema.deposito);
    const pie = deps.find((d) => d.nombre === "Pie de máquina")!.id;
    const proceso = deps.find((d) => d.nombre === "Tolva / en proceso")!.id;
    const copo = s.materiaPrima.copo2240.id;
    expect((await registrarRetiroMaquina(s.usuarios.RETIROS_MP, { cicloId, lineas: [{ materiaPrimaId: copo, loteMpId: null, cantidadKg: 50 }] })).error).toBeUndefined();
    expect((await registrarLimpieza(s.usuarios.OPERARIO, { cicloId, materiaPrimaId: copo, kg: 5 })).error).toMatch(/Recibí la máquina/);
    expect((await tomarTurno(s.usuarios.OPERARIO, { cicloId, turno: "NOCHE", operarioNombre: "Juan" })).error).toBeUndefined();
    expect((await registrarLimpieza(s.usuarios.OPERARIO, { cicloId, materiaPrimaId: copo, kg: 60 })).error).toMatch(/A pie de máquina hay 50 kg/);
    expect((await registrarLimpieza(s.usuarios.OPERARIO, { cicloId, materiaPrimaId: copo, kg: 5, detalle: "De rojo a negro" })).error).toBeUndefined();
    expect(await saldo(copo, pie)).toBe(45);
    expect(await saldo(copo, proceso)).toBe(5);
    const [n] = await db().select().from(schema.novedadMaquina).where(eq(schema.novedadMaquina.motivo, MOTIVO_LIMPIEZA));
    expect(n).toMatchObject({ tipo: "CARGA_DISTINTA", detalle: "5 kg · De rojo a negro" });
  });
});
