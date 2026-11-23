/**
 * Cambios en Producción (Nachi, 07/11/2026): uno asigna, otro arranca; el
 * material llega a la máquina sólo por un retiro; app del operario por estados.
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
import { actualizarTanda, crearTanda } from "@/lib/data/planificacion";
import { cancelarProduccion, cerrarTurno, colaDeMaquina, iniciarTandaAsignada, vistaTaller } from "@/lib/data/taller";
import { registrarRetiroMaquina } from "@/lib/data/maquina";
import { nombreCortoMp } from "@/lib/codigos-mp";

let s: Semilla;
const db = () => holder.db!;
let tandaA: number;
let tandaB: number;
let cicloId: number;

beforeAll(async () => {
  s = await sembrar(await abrirBase());
  tandaA = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejNegro.id, lineas: [], cantidadStock: 40 })).id!;
  tandaB = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejBlanco.id, lineas: [], cantidadStock: 20 })).id!;
  await actualizarTanda(s.usuarios.ENCARGADO, tandaA, { turno: "TARDE" });
  await actualizarTanda(s.usuarios.ENCARGADO, tandaB, { turno: "MANANA" });
});
afterAll(cerrarBase);

describe("cola de la máquina y arranque", () => {
  it("la cola va por día, turno y orden", async () => {
    // Sin fecha, la de la mañana va antes que la de la tarde aunque se haya creado después.
    expect((await colaDeMaquina("8")).map((t) => t.id)).toEqual([tandaB, tandaA]);
    await actualizarTanda(s.usuarios.ENCARGADO, tandaB, { turno: "NOCHE" });
    expect((await colaDeMaquina("8")).map((t) => t.id)).toEqual([tandaA, tandaB]);
  });

  it("arrancar otra que no es la primera pide motivo; en nombre del operario, operario y motivo", async () => {
    expect((await iniciarTandaAsignada(s.usuarios.OPERARIO, { tandaId: tandaB, golpesInicio: 0, turno: "MANANA" })).error).toMatch(/primera de la cola/);
    expect((await iniciarTandaAsignada(s.usuarios.ENCARGADO, { tandaId: tandaA, golpesInicio: 0, turno: "MANANA" })).error).toMatch(/operario/);
    expect((await iniciarTandaAsignada(s.usuarios.ENCARGADO, { tandaId: tandaA, golpesInicio: 0, turno: "MANANA", operarioNombre: "Ariel" })).error).toMatch(/por qué/);
  });

  it("el material se lleva antes de arrancar y pasa a la producción al arrancar", async () => {
    const ra = await registrarRetiroMaquina(s.usuarios.RETIROS_MP, { cicloId: null, tandaId: tandaA, lineas: [{ materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: null, cantidadKg: 50 }] });
    expect(ra.error).toBeUndefined();
    const rb = await registrarRetiroMaquina(s.usuarios.MATERIA_PRIMA, { cicloId: null, tandaId: tandaB, lineas: [{ materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: null, cantidadKg: 25 }] });
    expect(rb.error).toBeUndefined();
    let v = await vistaTaller("8");
    expect(v.asignadas.find((t) => t.id === tandaA)!.enPie).toMatchObject([{ kg: 50 }]);
    expect(v.asignadas.find((t) => t.id === tandaB)!.enPie).toMatchObject([{ kg: 25 }]);

    const r = await iniciarTandaAsignada(s.usuarios.OPERARIO, { tandaId: tandaA, golpesInicio: 100, turno: "MANANA", operarioNombre: "Ariel" });
    expect(r.error).toBeUndefined();
    cicloId = r.cicloId!;
    const [ret] = await db().select().from(schema.retiroMaquina).where(eq(schema.retiroMaquina.id, ra.id!));
    expect(ret.cicloId).toBe(cicloId);
    // A pie de máquina, el operario ve sólo lo de su producción; lo de la tanda que sigue queda aparte.
    v = await vistaTaller("8");
    expect(v.pie).toMatchObject([{ kg: 50, nombre: "Copolímero" }]);
    expect(v.asignadas[0]).toMatchObject({ id: tandaB, enPie: [{ kg: 25 }] });
    expect(v.produccion).toMatchObject({ hayCargas: false, contadorObjetivo: 140 });
  });
});

describe("cierre de turno y cancelación", () => {
  it("el descarte va en piezas y no puede superar las del turno; se guarda en kg con el peso por pieza", async () => {
    expect((await cerrarTurno(s.usuarios.OPERARIO, { cicloId, golpesFin: 110, descartePiezas: 11 })).error).toMatch(/no puede superar/);
    expect((await cerrarTurno(s.usuarios.OPERARIO, { cicloId, golpesFin: 110, descartePiezas: 1.5 })).error).toMatch(/entero/);
    expect((await cerrarTurno(s.usuarios.OPERARIO, { cicloId, golpesFin: 110, descartePiezas: 2 })).error).toBeUndefined();
    const [c] = await db().select().from(schema.cicloProduccion).where(eq(schema.cicloProduccion.id, cicloId));
    expect(Number(c.descarteKg)).toBeCloseTo(1.22, 3);
    expect((await vistaTaller("8")).produccion).toMatchObject({ descartePiezas: 2, producido: 10 });
  });

  it("cancelar una producción es del Encargado", async () => {
    expect((await cancelarProduccion(s.usuarios.OPERARIO, { cicloId, motivo: "x" })).error).toMatch(/Encargado/);
  });
});

describe("nombres cortos de material en planta", () => {
  it("sin código ni números de proveedor", () => {
    expect(nombreCortoMp("31-COPOLIMERO 2240 P")).toBe("Copolímero");
    expect(nombreCortoMp("B10-Master Gris Oscuro nor 108900 (gris claro catalogo)")).toBe("Master Gris Oscuro Nor");
    expect(nombreCortoMp("P10-Master negro991333")).toBe("Master Negro");
    expect(nombreCortoMp("3-Polipropileno COPOLIMERO   COD:2630PC")).toBe("Polipropileno Copolímero");
  });
});
