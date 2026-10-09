/**
 * Circuito de materia prima con pie de máquina (requerimiento de octubre 2026):
 * retiro → carga en tolva → producción → devolución / sobrante → conciliación,
 * continuidad entre turnos, repeticiones, concurrencia, correcciones de
 * Supervisión, cantidades a producir y resumen de m² del pedido.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

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
import { cerrarCiclo, crearCiclo, resumenParaCiclo, type FinCicloInput, type NuevoCicloInput } from "@/lib/data/produccion";
import {
  cargarEnTolva,
  cerrarRetiro,
  controlMaterialCiclo,
  devolverADeposito,
  identificarCodigoMp,
  obtenerRetirosMaquina,
  registrarRetiroMaquina,
  registrarSobrante,
} from "@/lib/data/maquina";
import { anularLineaRetiro, anularMovimientoMaquina, corregirCierreCiclo, corregirIngresoLote } from "@/lib/data/correcciones";
import { ingresarMateriaPrima } from "@/lib/data/materia-prima";
import { crearPedido } from "@/lib/data/pedidos";
import { trazarLote } from "@/lib/data/trazabilidad";
import { listarAuditoria } from "@/lib/data/auditoria";
import { resumirPedido } from "@/lib/resumen-pedido";
import { puedeVerPrecios } from "@/lib/auth/permisos";
import { actualizarDatosTecnicos } from "@/lib/data/catalogo";

let s: Semilla;
const db = () => holder.db!;
let masterId: number;
let sobranteId: number;
const LOTE = `0000031${"44444444"}${"000000000123"}`;

async function stockMp(id: number) {
  const [f] = await db().select().from(schema.saldo).where(eq(schema.saldo.materiaPrimaId, id));
  return Number(f?.cantidad ?? 0);
}
async function stockProd(id: number) {
  const [f] = await db().select().from(schema.saldo).where(eq(schema.saldo.productoId, id));
  return Number(f?.cantidad ?? 0);
}
function ciclo(over: Partial<NuevoCicloInput>): NuevoCicloInput {
  return { fecha: "2026-10-09", inyectora: "8", productoId: s.productos.rejNegro.id, operarioId: null, golpesInicio: 0, piezasPorGolpe: 1, cicloSegundos: null, modo: null, partidaId: null, pedidos: [], usuarioId: s.usuarios.ENCARGADO.id, ...over };
}
function cierre(golpesFin: number, entregadas: number): FinCicloInput {
  return { golpesFin, piezasDescartadas: 0, piezasEntregadas: entregadas, coladaKg: null, rebarbaKg: null, scrapKg: null, cambioCicloCausa: null, observaciones: null, cerrarPartida: false, usuarioId: s.usuarios.ENCARGADO.id };
}

beforeAll(async () => {
  await abrirBase();
  s = await sembrar(db());
  const [master, sobrante] = await db()
    .insert(schema.materiaPrima)
    .values([
      { codigoInterno: "24", nombre: "24-Master negro 951", tipo: "MASTER" },
      { codigoInterno: "403", nombre: "403- sobrante polipropileno Copolimero", tipo: "SOBRANTE" },
    ])
    .returning();
  masterId = master.id;
  sobranteId = sobrante.id;
  const dep = s.deposito.id;
  await db().insert(schema.saldo).values([
    { depositoId: dep, materiaPrimaId: masterId, cantidad: "50" },
    { depositoId: dep, materiaPrimaId: sobranteId, cantidad: "0" },
  ]);
  await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, {
    materiaPrimaId: s.materiaPrima.copo2240.id,
    proveedor: "INDARNYL",
    fechaRecepcion: "2026-10-08",
    cantidadKg: 500,
    codigoBarra: LOTE,
    conCertificado: true,
  });
});

afterAll(async () => {
  await cerrarBase();
});

describe("Lectura de código de barras", () => {
  it("identifica el lote y su certificado; un código asignado a otro producto se rechaza", async () => {
    const r = await identificarCodigoMp(LOTE, "001");
    expect(r.dato?.lote?.numeroLote).toBe("000000000123");
    expect(r.dato?.certificado?.numero).toBe(1);
    expect(r.dato?.disponibleKg).toBe(500);
    // Ya asignado al producto 001 (tres primeros dígitos): válido para 001, no para 031.
    expect((await identificarCodigoMp(`001${LOTE.slice(3)}`, "001")).dato?.lote).not.toBeNull();
    expect((await identificarCodigoMp(`001${LOTE.slice(3)}`, "031")).error).toMatch(/asignado al producto 001/);
    const desconocido = await identificarCodigoMp(`000${"9".repeat(24)}`);
    expect(desconocido.dato?.lote).toBeNull();
    expect(desconocido.dato?.advertencias.join(" ")).toMatch(/completá/);
    expect((await identificarCodigoMp("123")).error).toBeDefined();
  });
});

describe("Circuito completo: retiro → tolva → producción → devolución → conciliación", () => {
  let c1: number;
  let retiroId: number;
  let lineaVirgen: number;
  let lineaMaster: number;

  it("retiro a pie de máquina: descuenta el depósito una sola vez, aunque el formulario se envíe dos veces", async () => {
    const c = await crearCiclo(ciclo({ cantidadDeseada: 150 }));
    if ("error" in c) throw new Error(c.error);
    c1 = c.id;
    const [lote] = await db().select().from(schema.loteMp).where(eq(schema.loteMp.codigoBarra, LOTE));
    const antes = await stockMp(s.materiaPrima.copo2240.id);
    const entrada = {
      cicloId: c1,
      operarioId: s.usuarios.OPERARIO.id,
      entregaId: s.usuarios.MATERIA_PRIMA.id,
      piezasPrevistas: 100,
      token: "form-retiro-1",
      lineas: [
        { materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: lote.id, cantidadKg: 100, codigoLeido: `001${LOTE.slice(3)}` },
        { materiaPrimaId: masterId, loteMpId: null, cantidadKg: 1.5 },
      ],
    };
    const r1 = await registrarRetiroMaquina(s.usuarios.RETIROS_MP, entrada);
    const r2 = await registrarRetiroMaquina(s.usuarios.RETIROS_MP, entrada);
    expect(r1.error).toBeUndefined();
    expect(r2).toMatchObject({ id: r1.id, repetido: true });
    retiroId = r1.id!;
    [lineaVirgen, lineaMaster] = r1.lineaIds!;
    expect(await stockMp(s.materiaPrima.copo2240.id)).toBe(antes - 100);
    expect(await stockMp(masterId)).toBe(48.5);
    const [rm] = await db().select().from(schema.retiroMaquina).where(eq(schema.retiroMaquina.id, retiroId));
    expect(rm).toMatchObject({ inyectora: "8", estado: "ABIERTO", piezasPrevistas: 100, operarioId: s.usuarios.OPERARIO.id });
  });

  it("valida el código leído contra el lote elegido", async () => {
    const r = await registrarRetiroMaquina(s.usuarios.RETIROS_MP, {
      cicloId: c1,
      lineas: [{ materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: (await db().select().from(schema.loteMp))[0].id, cantidadKg: 1, codigoLeido: `000${"1".repeat(24)}` }],
    });
    expect(r.error).toMatch(/no corresponde al lote/);
  });

  it("carga en tolva: sale de pie de máquina sin volver a tocar el depósito; la misma carga repetida no se duplica", async () => {
    const deposito = await stockMp(s.materiaPrima.copo2240.id);
    const a = await cargarEnTolva(s.usuarios.RETIROS_MP, { retiroMpId: lineaVirgen, cantidadKg: 60, cicloId: c1, token: "carga-1" });
    const b = await cargarEnTolva(s.usuarios.RETIROS_MP, { retiroMpId: lineaVirgen, cantidadKg: 60, cicloId: c1, token: "carga-1" });
    expect(a.error).toBeUndefined();
    expect(b).toMatchObject({ id: a.id, repetido: true });
    await cargarEnTolva(s.usuarios.RETIROS_MP, { retiroMpId: lineaMaster, cantidadKg: 0.9, cicloId: c1 });
    expect(await stockMp(s.materiaPrima.copo2240.id)).toBe(deposito);
    const [r] = await obtenerRetirosMaquina({ ids: [retiroId] });
    expect(r.lineas.find((l) => l.id === lineaVirgen)!.saldo).toMatchObject({ retirado: 100, cargado: 60, pie: 40 });
    // No se puede cargar más de lo que hay a pie de máquina.
    expect((await cargarEnTolva(s.usuarios.RETIROS_MP, { retiroMpId: lineaVirgen, cantidadKg: 41, cicloId: c1 })).error).toMatch(/quedan 40/);
  });

  it("producción y control de material: teóricas con el peso por pieza configurado", async () => {
    expect((await cerrarCiclo(c1, cierre(95, 95))).error).toBeUndefined();
    const ctl = (await controlMaterialCiclo(c1))!;
    expect(ctl).toMatchObject({ retirado: 101.5, cargadoVirgen: 60, masterIncorporado: 0.9, kgPorPieza: 0.61, piezasBuenas: 95 });
    expect(ctl.piezasTeoricas).toBe(Math.floor(60.9 / 0.61));
    expect(ctl.diferenciaKg).toBeCloseTo(60.9 - 95 * 0.61, 3);
  });

  it("el retiro sigue abierto entre turnos: el día siguiente (misma partida) se carga en el ciclo nuevo", async () => {
    const [p] = await db().select().from(schema.cicloProduccion).where(eq(schema.cicloProduccion.id, c1));
    const c2 = await crearCiclo(ciclo({ partidaId: p.partidaId, golpesInicio: 95, fecha: "2026-10-10" }));
    if ("error" in c2) throw new Error(c2.error);
    expect((await cargarEnTolva(s.usuarios.OPERARIO.rol === "OPERARIO" ? s.usuarios.RETIROS_MP : s.usuarios.RETIROS_MP, { retiroMpId: lineaVirgen, cantidadKg: 20, cicloId: c2.id })).error).toBeUndefined();
    // Otra producción (otra partida/producto) en la misma inyectora: hay que devolver, no cargar.
    expect((await cerrarCiclo(c2.id, cierre(120, 25))).error).toBeUndefined();
    const otro = await crearCiclo(ciclo({ productoId: s.productos.rejRojo.id, fecha: "2026-10-10" }));
    if ("error" in otro) throw new Error(otro.error);
    expect((await cargarEnTolva(s.usuarios.RETIROS_MP, { retiroMpId: lineaVirgen, cantidadKg: 5, cicloId: otro.id })).error).toMatch(/otra producción/);
  });

  it("cambio de producto: el virgen sin mezclar vuelve al depósito; lo mezclado sale como sobrante con su código", async () => {
    const antes = await stockMp(s.materiaPrima.copo2240.id);
    expect((await devolverADeposito(s.usuarios.RETIROS_MP, { retiroMpId: lineaVirgen, cantidadKg: 21 })).error).toMatch(/quedan 20/);
    expect((await devolverADeposito(s.usuarios.RETIROS_MP, { retiroMpId: lineaVirgen, cantidadKg: 20 })).error).toBeUndefined();
    expect(await stockMp(s.materiaPrima.copo2240.id)).toBe(antes + 20);
    const [lote] = await db().select().from(schema.loteMp).where(eq(schema.loteMp.codigoBarra, LOTE));
    expect((await trazarLote(LOTE))!.usos.length).toBeGreaterThan(0);
    // El lote recupera lo devuelto.
    const { disponibleDeLotes } = await import("@/lib/data/maquina");
    expect((await disponibleDeLotes(db() as never, [lote.id])).get(lote.id)).toBe(420);

    expect((await registrarSobrante(s.usuarios.RETIROS_MP, { retiroMaquinaId: retiroId, materiaPrimaDestinoId: s.materiaPrima.copo2240.id, cantidadKg: 1 })).error).toMatch(/sobrante o molienda/);
    expect((await registrarSobrante(s.usuarios.RETIROS_MP, { retiroMaquinaId: retiroId, materiaPrimaDestinoId: sobranteId, cantidadKg: 500 })).error).toMatch(/se cargaron/);
    expect((await registrarSobrante(s.usuarios.RETIROS_MP, { retiroMaquinaId: retiroId, materiaPrimaDestinoId: sobranteId, cantidadKg: 3.2 })).error).toBeUndefined();
    expect(await stockMp(sobranteId)).toBe(3.2);
    const [mov] = await db().select().from(schema.movimiento).where(and(eq(schema.movimiento.materiaPrimaId, sobranteId), eq(schema.movimiento.tipo, "ENTRADA")));
    expect(mov.motivo).toMatch(/composición: 31-COPOLIMERO 2240 P \+ 24-Master negro 951/);
  });

  it("conciliación: no cierra con material pendiente sin justificar; la diferencia justificada queda registrada", async () => {
    const r1 = await cerrarRetiro(s.usuarios.RETIROS_MP, retiroId, {});
    expect(r1.error).toMatch(/a pie de máquina/);
    expect(r1.pendientes).toEqual([{ retiroMpId: lineaMaster, pie: 0.6 }]);
    expect((await cerrarRetiro(s.usuarios.RETIROS_MP, retiroId, { [lineaMaster]: "master derramado al cargar" })).error).toBeUndefined();
    const [r] = await obtenerRetirosMaquina({ ids: [retiroId] });
    expect(r.estado).toBe("CERRADO");
    expect(r.totales.pie).toBe(0);
    expect(r.movimientos.find((m) => m.tipo === "DIFERENCIA")).toMatchObject({ cantidad: 0.6, observaciones: "master derramado al cargar" });
    // Cerrado: no admite más operaciones.
    expect((await devolverADeposito(s.usuarios.RETIROS_MP, { retiroMpId: lineaVirgen, cantidadKg: 1 })).error).toMatch(/cerrado/);
  });
});

describe("Concurrencia y permisos", () => {
  it("dos retiros simultáneos a la misma inyectora no superan el stock", async () => {
    const stock = await stockMp(s.materiaPrima.copo2240.id);
    const pedir = Math.ceil(stock / 2) + 1;
    const intentos = await Promise.all(
      [1, 2].map(() => registrarRetiroMaquina(s.usuarios.RETIROS_MP, { cicloId: null, inyectora: "8", lineas: [{ materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: null, cantidadKg: pedir }] })),
    );
    expect(intentos.filter((r) => r.error)).toHaveLength(1);
    expect(await stockMp(s.materiaPrima.copo2240.id)).toBe(stock - pedir);
  });

  it("un rol sin permiso no retira, carga ni corrige", async () => {
    const op = s.usuarios.ADMINISTRACION;
    expect((await registrarRetiroMaquina(op, { cicloId: null, inyectora: "8", lineas: [{ materiaPrimaId: masterId, loteMpId: null, cantidadKg: 1 }] })).error).toMatch(/permiso/);
    expect((await cargarEnTolva(op, { retiroMpId: 1, cantidadKg: 1, cicloId: 1 })).error).toMatch(/permiso/);
    expect((await anularLineaRetiro(s.usuarios.ENCARGADO, 1, "x")).error).toMatch(/Supervisión/);
    expect((await corregirCierreCiclo(s.usuarios.GERENCIA, 1, { piezasEntregadas: 1 }, "x")).error).toMatch(/Supervisión/);
  });
});

describe("Correcciones de Supervisión (auditadas, sin borrar historial)", () => {
  it("anular una carga devuelve el material a pie de máquina; anular una devolución revierte el stock", async () => {
    const c = await crearCiclo(ciclo({ productoId: s.productos.rejBlanco.id }));
    if ("error" in c) throw new Error(c.error);
    const r = await registrarRetiroMaquina(s.usuarios.RETIROS_MP, { cicloId: c.id, lineas: [{ materiaPrimaId: masterId, loteMpId: null, cantidadKg: 2 }] });
    const linea = r.lineaIds![0];
    const carga = await cargarEnTolva(s.usuarios.RETIROS_MP, { retiroMpId: linea, cantidadKg: 1.5, cicloId: c.id });
    expect((await anularMovimientoMaquina(s.usuarios.SUPERVISOR, carga.id!, "")).error).toMatch(/motivo/);
    expect((await anularMovimientoMaquina(s.usuarios.SUPERVISOR, carga.id!, "se cargó en otra máquina")).error).toBeUndefined();
    let [rm] = await obtenerRetirosMaquina({ ids: [r.id!] });
    expect(rm.lineas[0].saldo.pie).toBe(2);
    expect(await db().select().from(schema.cicloMateriaPrima).where(eq(schema.cicloMateriaPrima.movimientoMaquinaId, carga.id!))).toHaveLength(0);

    const stock = await stockMp(masterId);
    const dev = await devolverADeposito(s.usuarios.RETIROS_MP, { retiroMpId: linea, cantidadKg: 2 });
    expect(await stockMp(masterId)).toBe(stock + 2);
    expect((await anularMovimientoMaquina(s.usuarios.SUPERVISOR, dev.id!, "no se devolvió físicamente")).error).toBeUndefined();
    expect(await stockMp(masterId)).toBe(stock);
    [rm] = await obtenerRetirosMaquina({ ids: [r.id!] });
    expect(rm.movimientos.every((m) => m.anulado)).toBe(true);

    // Anular la línea entera: el material vuelve al depósito.
    expect((await anularLineaRetiro(s.usuarios.SUPERVISOR, linea, "retiro cargado dos veces")).error).toBeUndefined();
    expect(await stockMp(masterId)).toBe(stock + 2);
    const audit = await listarAuditoria({ entidad: "retiro_mp", entidadId: linea });
    expect(audit[0]).toMatchObject({ campo: "anulación", motivo: "retiro cargado dos veces", usuarioNombre: "Usuario SUPERVISOR" });
  });

  it("corregir el cierre: las piezas a stock se regularizan con un ajuste y en las cajas", async () => {
    const c = await crearCiclo(ciclo({ productoId: s.productos.rejBlanco.id, golpesInicio: 0 }));
    if ("error" in c) throw new Error(c.error);
    await cerrarCiclo(c.id, cierre(60, 50));
    const antes = await stockProd(s.productos.rejBlanco.id);
    expect((await corregirCierreCiclo(s.usuarios.SUPERVISOR, c.id, { piezasEntregadas: 45 }, "se contaron 5 de más")).error).toBeUndefined();
    expect(await stockProd(s.productos.rejBlanco.id)).toBe(antes - 5);
    const cajas = await db().select().from(schema.caja).where(eq(schema.caja.cicloId, c.id));
    expect(cajas.reduce((t, x) => t + x.cantidad, 0)).toBe(45);
    expect((await corregirCierreCiclo(s.usuarios.SUPERVISOR, c.id, { piezasEntregadas: 61 }, "x")).error).toMatch(/no pueden superar/);
    expect((await corregirCierreCiclo(s.usuarios.SUPERVISOR, c.id, { piezasEntregadas: 55 }, "faltaba una caja")).error).toBeUndefined();
    expect(await stockProd(s.productos.rejBlanco.id)).toBe(antes + 5);
    const audit = await listarAuditoria({ entidad: "ciclo_produccion", entidadId: c.id });
    expect(audit.map((a) => [a.campo, a.valorAnterior, a.valorNuevo])).toEqual(
      expect.arrayContaining([
        ["piezasEntregadas", "50", "45"],
        ["piezasEntregadas", "45", "55"],
      ]),
    );
  });

  it("corregir el ingreso de un lote ajusta stock y lote, sin dejar el lote negativo", async () => {
    const [lote] = await db().select().from(schema.loteMp).where(eq(schema.loteMp.codigoBarra, LOTE));
    const stock = await stockMp(s.materiaPrima.copo2240.id);
    expect((await corregirIngresoLote(s.usuarios.SUPERVISOR, lote.id, 10, "x")).error).toMatch(/ya se retiraron/);
    expect((await corregirIngresoLote(s.usuarios.SUPERVISOR, lote.id, 520, "el remito decía 520 kg")).error).toBeUndefined();
    expect(await stockMp(s.materiaPrima.copo2240.id)).toBe(stock + 20);
  });
});

describe("Cantidad a producir: necesidad, reposición y deseada", () => {
  it("separa la necesidad de pedidos y la reposición hasta el mínimo; la deseada puede superarlas", async () => {
    // 008B rojo: mínimo 500, stock 168 (semilla).
    await crearPedido({
      clienteId: s.cliente.id,
      fechaPedido: "2026-10-09",
      fechaEntregaPactada: null,
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
      lineas: [{ productoId: s.productos.rejRojo.id, colorTexto: null, unidadesPedidas: 100 }],
    });
    const r = (await resumenParaCiclo(s.productos.rejRojo.id))!;
    expect(r.faltaProducir).toBe(0); // 168 alcanzan para 100
    expect(r.reposicion).toBe(500 - 68); // quedan 68 libres
    expect(r.recomendado).toBe(432);
    const c = await crearCiclo(ciclo({ productoId: s.productos.rejRojo.id, cantidadDeseada: 900 }));
    if ("error" in c) throw new Error(c.error);
    const [f] = await db().select().from(schema.cicloProduccion).where(eq(schema.cicloProduccion.id, c.id));
    expect(f.cantidadDeseada).toBe(900);
    expect(await crearCiclo(ciclo({ productoId: s.productos.rejRojo.id, cantidadDeseada: -3 }))).toMatchObject({ error: /entero mayor que cero/ });
  });
});

describe("Resumen del pedido y superficie", () => {
  it("separa baldosas y accesorios, suma m² sólo de pisos y marca los que no tienen superficie", () => {
    const r = resumirPedido([
      { productoId: 1, codigo: "002B-PR-GO", familia: "REJILLA", tipo: "UNICO", esAccesorio: false, colorNombre: "Gris Oscuro", unidades: 100, m2PorUnidad: 0.16 },
      { productoId: 2, codigo: "045B-PM-AC", familia: "CIEGO", tipo: "MONEDA", esAccesorio: false, colorNombre: "Azul", unidades: 50, m2PorUnidad: null },
      { productoId: 3, codigo: "052B-EC-AO", familia: "CIEGO", tipo: "ESQUINERO", esAccesorio: true, colorNombre: "Azul Oscuro", unidades: 4, m2PorUnidad: null },
      { productoId: 4, codigo: "061B-RC-AO", familia: "CIEGO", tipo: "RAMPA", esAccesorio: true, colorNombre: "Azul Oscuro", unidades: 20, m2PorUnidad: null },
      { productoId: null, codigo: null, familia: null, tipo: null, esAccesorio: null, colorNombre: null, unidades: 1, m2PorUnidad: null },
    ]);
    expect(r.baldosas).toEqual([
      { etiqueta: "Piso Rejilla, Gris Oscuro", unidades: 100, m2: 16 },
      { etiqueta: "Piso Ciego Moneda, Azul", unidades: 50, m2: null },
    ]);
    expect(r.accesorios.map((a) => [a.etiqueta, a.unidades])).toEqual([
      ["Esquineros (Ciego), Azul Oscuro", 4],
      ["Rampas (Ciego), Azul Oscuro", 20],
    ]);
    expect(r.totalBaldosas).toBe(150);
    expect(r.m2Total).toBe(16);
    expect(r.sinSuperficie).toEqual(["045B-PM-AC"]);
    expect(r.sinProducto).toBe(1);
  });

  it("la superficie y el peso se configuran por producto (auditado); un accesorio no lleva m²", async () => {
    expect((await actualizarDatosTecnicos(s.usuarios.ENCARGADO, s.productos.esqNegro.id, { m2PorUnidad: 0.1, kgPorUnidad: 0.02 })).error).toMatch(/accesorio/);
    expect((await actualizarDatosTecnicos(s.usuarios.ENCARGADO, s.productos.esqNegro.id, { m2PorUnidad: null, kgPorUnidad: 0.02 })).error).toBeUndefined();
    expect((await actualizarDatosTecnicos(s.usuarios.ADMINISTRACION, s.productos.esqNegro.id, { m2PorUnidad: null, kgPorUnidad: 0.03 })).error).toMatch(/permiso/);
    const audit = await listarAuditoria({ entidad: "producto", entidadId: s.productos.esqNegro.id });
    expect(audit.find((a) => a.campo === "kg_por_unidad")?.valorNuevo).toBe("0.02");
  });
});

describe("Vista de precios del Supervisor", () => {
  it("sólo el Supervisor accede a la vista completa al elegirla; el resto de los roles no cambia", () => {
    expect(puedeVerPrecios("SUPERVISOR")).toBe(false);
    expect(puedeVerPrecios("SUPERVISOR", true)).toBe(true);
    expect(puedeVerPrecios("ENCARGADO", true)).toBe(false);
    expect(puedeVerPrecios("DESPACHO", true)).toBe(false);
    expect(puedeVerPrecios("ADMINISTRACION")).toBe(true);
    expect(puedeVerPrecios("GERENCIA")).toBe(true);
  });
});
