/**
 * Cambios del 23/11/2026 (notas del socio): pedido de material con lo que
 * necesita el operario, OK o descarte del Encargado, avisos a Materia prima
 * cuando una tanda queda con día y turno, permisos del Encargado y datos de
 * la etiqueta nueva.
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

import { abrirBase, cerrarBase, holder, sembrar, type Semilla } from "./helpers/db";
import * as schema from "@/lib/db/schema";
import { actualizarTanda, cancelarTanda, crearTanda, listarTandas } from "@/lib/data/planificacion";
import { guardarReceta, listarPresentaciones } from "@/lib/data/recetas";
import { avisarPedidoMaterial, cargarReceta, descartarPedidoMaterial, iniciarTandaAsignada, pedidosDeMaterialPendientes, pedirMaterial } from "@/lib/data/taller";
import { registrarRetiroMaquina } from "@/lib/data/maquina";
import { paraLlevarAPie } from "@/lib/data/llevar-mp";
import { listarAvisos } from "@/lib/data/avisos";
import { registrarConteoMp } from "@/lib/data/conteo-mp";
import { puedeVerCompras } from "@/lib/auth/permisos";
import { rutaPermitida } from "@/lib/nav";
import { hoyISO, sumarDias } from "@/lib/format";

let s: Semilla;
const db = () => holder.db!;
const hoy = hoyISO();
const manana = sumarDias(hoy, 1);
let masterId: number;
let bolsa25: number;
let bolsita600: number;
const avisosMp = async () => (await listarAvisos("MATERIA_PRIMA")).filter((a) => a.tipo === "MATERIAL_PIE").map((a) => a.mensaje);

beforeAll(async () => {
  s = await sembrar(await abrirBase());
  const [master] = await db().insert(schema.materiaPrima).values({ codigoInterno: "24", nombre: "24-Master negro 951", tipo: "MASTER" }).returning();
  masterId = master.id;
  await db().insert(schema.saldo).values({ depositoId: s.deposito.id, materiaPrimaId: masterId, cantidad: "10" });
  const pres = await listarPresentaciones();
  bolsa25 = pres.find((p) => p.nombre === "Bolsa 25 kg")!.id;
  bolsita600 = pres.find((p) => p.nombre === "Bolsita 600 g")!.id;
  await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejNegro.id, "REGIMEN", {
    items: [
      { materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 4 },
      { materiaPrimaId: masterId, presentacionId: bolsita600, cantidad: 2 },
    ],
  });
});
afterAll(cerrarBase);

describe("Secuencia: Materia prima se entera cuando la tanda tiene día y turno", () => {
  let id: number;
  it("sin día ni turno no aparece para llevar ni avisa", async () => {
    id = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejNegro.id, lineas: [], cantidadStock: 100 })).id!;
    expect((await listarTandas()).find((t) => t.id === id)).toMatchObject({ fecha: null, turno: null });
    expect((await paraLlevarAPie()).find((t) => t.tandaId === id)).toBeUndefined();
    expect(await avisosMp()).toHaveLength(0);
  });

  it("al asignar día y turno le llega el aviso y aparece en la lista; al asignar no se tocan las cantidades", async () => {
    expect((await actualizarTanda(s.usuarios.ENCARGADO, id, { fecha: manana, turno: "MANANA" })).error).toBeUndefined();
    expect((await listarTandas()).find((t) => t.id === id)!.cantidadStock).toBe(100);
    expect((await paraLlevarAPie()).find((t) => t.tandaId === id)).toMatchObject({ dia: "manana", completa: false });
    expect((await avisosMp()).some((m) => /Hay que llevar material a pie de máquina: Negro Rejilla \(001B\) · 100 piezas, inyectora 8/.test(m))).toBe(true);
  });

  it("cada cambio del Encargado y la cancelación también le avisan", async () => {
    await actualizarTanda(s.usuarios.ENCARGADO, id, { turno: "TARDE" });
    expect((await avisosMp()).some((m) => /Cambió una tanda .* ahora inyectora 8, .* turno tarde/.test(m))).toBe(true);
    await cancelarTanda(s.usuarios.ENCARGADO, id, "prueba");
    expect((await avisosMp()).some((m) => /se canceló: no hace falta llevar ese material/.test(m))).toBe(true);
    expect((await paraLlevarAPie()).find((t) => t.tandaId === id)).toBeUndefined();
  });
});

describe("Pedido de material: el operario elige, el Encargado da el OK", () => {
  let cicloId: number;
  it("el operario carga la tolva eligiendo las bolsas; igual a la receta no pide motivo", async () => {
    const t = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejNegro.id, lineas: [], cantidadStock: 50, fecha: hoy, turno: "NOCHE" })).id!;
    await registrarRetiroMaquina(s.usuarios.MATERIA_PRIMA, { cicloId: null, tandaId: t, lineas: [{ materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: null, cantidadKg: 100 }, { materiaPrimaId: masterId, loteMpId: null, cantidadKg: 1.2 }] });
    cicloId = (await iniciarTandaAsignada(s.usuarios.OPERARIO, { tandaId: t, golpesInicio: 0, turno: "NOCHE" })).cicloId!;
    const igual = [
      { materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 4 },
      { materiaPrimaId: masterId, presentacionId: bolsita600, cantidad: 2 },
    ];
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN", ajustes: igual })).error).toBeUndefined();
  });

  it("el pedido dice qué y cuánto; Materia prima lo ve recién con el OK del Encargado", async () => {
    expect((await pedirMaterial(s.usuarios.OPERARIO, { cicloId, items: [] })).error).toMatch(/Elegí qué material/);
    const items = [{ materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 2 }];
    expect((await pedirMaterial(s.usuarios.OPERARIO, { cicloId, items })).error).toBeUndefined();
    const [p] = await pedidosDeMaterialPendientes();
    expect(p.n.pedido).toEqual([expect.objectContaining({ kg: 50, texto: "2 bolsas de 25 kg Copolímero" })]);
    expect(await pedidosDeMaterialPendientes({ soloAvisados: true })).toHaveLength(0);
    expect((await avisarPedidoMaterial(s.usuarios.OPERARIO, p.n.id)).error).toMatch(/Encargado/);
    expect((await avisarPedidoMaterial(s.usuarios.ENCARGADO, p.n.id)).error).toBeUndefined();
    expect(await pedidosDeMaterialPendientes({ soloAvisados: true })).toHaveLength(1);
    expect((await avisosMp()).some((m) => /Llevar a la inyectora 8: 2 bolsas de 25 kg/.test(m))).toBe(true);
  });

  it("si el Encargado lo descarta, desaparece", async () => {
    await registrarRetiroMaquina(s.usuarios.MATERIA_PRIMA, { cicloId, lineas: [{ materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: null, cantidadKg: 50 }] });
    const items = [{ materiaPrimaId: masterId, presentacionId: bolsita600, cantidad: 1 }];
    await pedirMaterial(s.usuarios.OPERARIO, { cicloId, items });
    const [p] = await pedidosDeMaterialPendientes();
    expect((await descartarPedidoMaterial(s.usuarios.ENCARGADO, p.n.id)).error).toBeUndefined();
    expect(await pedidosDeMaterialPendientes()).toHaveLength(0);
  });
});

describe("Permisos del Encargado", () => {
  it("no registra lo que se lleva, no hace conteo físico y no ve Compras ni Clientes", async () => {
    expect((await registrarRetiroMaquina(s.usuarios.ENCARGADO, { cicloId: null, inyectora: "8", lineas: [{ materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: null, cantidadKg: 1 }] })).error).toMatch(/permiso/);
    expect((await registrarConteoMp(s.usuarios.ENCARGADO, { fecha: hoy, lineas: [] })).error).toMatch(/lo carga Materia prima/);
    expect(puedeVerCompras("ENCARGADO")).toBe(false);
    expect(rutaPermitida("ENCARGADO", "/clientes")).toBe(false);
    expect(rutaPermitida("ENCARGADO", "/compras")).toBe(false);
    expect(rutaPermitida("ENCARGADO", "/etiquetas")).toBe(true);
    // Sigue viendo el stock de materia prima.
    expect(rutaPermitida("ENCARGADO", "/materia-prima")).toBe(true);
  });
});
