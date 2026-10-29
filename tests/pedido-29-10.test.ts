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
