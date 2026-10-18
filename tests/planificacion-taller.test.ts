/**
 * Minuta 15/10/2026: planificación agrupada por producto y color, recetas de
 * carga en presentaciones, vista del operario con relevo de turno y stock de
 * materia prima por ubicación (depósito → pie de máquina → tolva → consumo).
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
import { crearPedido } from "@/lib/data/pedidos";
import {
  actualizarTanda,
  alertaEntrega,
  crearTanda,
  gruposParaPlanificar,
  iniciarProduccionDeTanda,
  listarTandas,
  materialParaPiezas,
  moverTanda,
  necesidadDeCompra,
  postergarTanda,
  quitarPedidosDeTanda,
} from "@/lib/data/planificacion";
import { guardarReceta, listarPresentaciones, recetasDe } from "@/lib/data/recetas";
import { cargarReceta, cerrarProduccionTaller, cerrarTurno, registrarNovedad, tomarTurno, vistaTaller } from "@/lib/data/taller";
import { cerrarRetiro, devolverADeposito, obtenerRetirosMaquina, registrarRetiroMaquina, registrarSobrante } from "@/lib/data/maquina";
import { anularMovimientoMaquina } from "@/lib/data/correcciones";
import { fmtCantidadBolsas, fmtPeso, kgDe, parseCantidadAR } from "@/lib/presentaciones";

let s: Semilla;
const db = () => holder.db!;
let masterId: number;
let sobranteId: number;
let bolsa25: number;
let bolsita600: number;
let bolsita750: number;
const ubic: Record<"deposito" | "pie" | "proceso", number> = { deposito: 0, pie: 0, proceso: 0 };

async function saldoMp(mpId: number, depositoId: number) {
  const [f] = await db().select().from(schema.saldo).where(and(eq(schema.saldo.materiaPrimaId, mpId), eq(schema.saldo.depositoId, depositoId)));
  return Number(f?.cantidad ?? 0);
}
async function totalMp(mpId: number) {
  return (await saldoMp(mpId, ubic.deposito)) + (await saldoMp(mpId, ubic.pie)) + (await saldoMp(mpId, ubic.proceso));
}
async function stockProd(id: number) {
  const [f] = await db().select().from(schema.saldo).where(and(eq(schema.saldo.productoId, id), eq(schema.saldo.depositoId, s.deposito.id)));
  return Number(f?.cantidad ?? 0);
}
async function pedido(productoId: number, unidades: number, fechaPedido: string, fechaEntregaPactada: string | null = null) {
  const r = await crearPedido({
    clienteId: s.cliente.id,
    numeroOrden: null,
    fechaPedido,
    fechaEntregaPactada,
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
  if (!("id" in r)) throw new Error(r.error);
  const [l] = await db().select().from(schema.pedidoLinea).where(eq(schema.pedidoLinea.pedidoId, r.id));
  return { id: r.id, lineaId: l.id };
}

beforeAll(async () => {
  await abrirBase();
  s = await sembrar(db());
  const deps = await db().select().from(schema.deposito);
  ubic.deposito = s.deposito.id;
  ubic.pie = deps.find((d) => d.nombre === "Pie de máquina")!.id;
  ubic.proceso = deps.find((d) => d.nombre === "Tolva / en proceso")!.id;
  const [master, sobrante] = await db()
    .insert(schema.materiaPrima)
    .values([
      { codigoInterno: "24", nombre: "24-Master negro 951", tipo: "MASTER" },
      { codigoInterno: "403", nombre: "403- sobrante copolímero 2240 c/ negro", tipo: "SOBRANTE" },
    ])
    .returning();
  masterId = master.id;
  sobranteId = sobrante.id;
  await db().insert(schema.saldo).values({ depositoId: s.deposito.id, materiaPrimaId: masterId, cantidad: "10" });
  const pres = await listarPresentaciones();
  bolsa25 = pres.find((p) => p.nombre === "Bolsa 25 kg")!.id;
  bolsita600 = pres.find((p) => p.nombre === "Bolsita 600 g")!.id;
  bolsita750 = pres.find((p) => p.nombre === "Bolsita 750 g")!.id;
});

afterAll(async () => {
  await cerrarBase();
});

describe("Cantidades físicas", () => {
  it("convierte bolsas a kg y gramos sin errores de redondeo; acepta medias bolsas", () => {
    expect(kgDe(4, 25)).toBe(100);
    expect(kgDe(2, 0.6)).toBe(1.2);
    expect(kgDe(3, 0.6)).toBe(1.8);
    expect(kgDe(0.5, 25)).toBe(12.5);
    expect(fmtCantidadBolsas(1.5)).toBe("1½");
    expect(fmtCantidadBolsas(0.5)).toBe("½");
    expect(fmtPeso(1.2, { gramos: true })).toBe("1.200 g");
    expect(fmtPeso(0.046)).toBe("46 g");
  });

  it("interpreta 1.500 como mil quinientos y 1,5 como uno y medio (error de carga de la minuta)", () => {
    expect(parseCantidadAR("1.500")).toBe(1500);
    expect(parseCantidadAR("4.500")).toBe(4500);
    expect(parseCantidadAR("1,5")).toBe(1.5);
    expect(parseCantidadAR("1.500,25")).toBe(1500.25);
    expect(parseCantidadAR("25")).toBe(25);
    expect(parseCantidadAR("abc")).toBeNull();
  });
});

describe("Recetas de carga", () => {
  it("el Encargado define la receta en presentaciones; el sistema calcula kg y gramos de master", async () => {
    const r = await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejNegro.id, "REGIMEN", {
      items: [
        { materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 4 },
        { materiaPrimaId: masterId, presentacionId: bolsita600, cantidad: 2 },
      ],
      motivo: "Planilla de carga en tolva",
    });
    expect(r.error).toBeUndefined();
    const receta = (await recetasDe([s.productos.rejNegro.id])).get(s.productos.rejNegro.id)!.REGIMEN!;
    expect(receta.kgVirgen).toBe(100);
    expect(receta.kgMaster).toBe(1.2);
    expect(receta.gMasterPorKg).toBe(12);
    expect(receta.items.map((i) => i.texto)).toEqual(["4 bolsas de 25 kg", "2 bolsitas de 600 g"]);
    // Arranque reforzada al cambiar de color.
    expect(
      (
        await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejNegro.id, "ARRANQUE", {
          items: [
            { materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 4 },
            { materiaPrimaId: masterId, presentacionId: bolsita600, cantidad: 1 },
            { materiaPrimaId: masterId, presentacionId: bolsita750, cantidad: 1 },
          ],
        })
      ).error,
    ).toBeUndefined();
  });

  it("valida presentación del material, medias bolsas y permisos; queda en el historial", async () => {
    const mal = await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejRojo.id, "REGIMEN", { items: [{ materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsita600, cantidad: 4 }] });
    expect(mal.error).toMatch(/no corresponde/);
    const tercio = await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejRojo.id, "REGIMEN", { items: [{ materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 1.3 }] });
    expect(tercio.error).toMatch(/medias/);
    expect((await guardarReceta(s.usuarios.OPERARIO, s.productos.rejRojo.id, "REGIMEN", { items: [{ materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 4 }] })).error).toMatch(/permiso/);
    const audit = await db().select().from(schema.auditoriaConfig).where(eq(schema.auditoriaConfig.entidad, "receta_carga"));
    expect(audit.find((a) => a.campo === "receta de régimen")).toMatchObject({ valorNuevo: expect.stringContaining("4 bolsas de 25 kg") });
  });

  it("material para una cantidad de piezas: cargas redondeadas hacia arriba, arranque en la primera", async () => {
    const r = (await recetasDe([s.productos.rejNegro.id])).get(s.productos.rejNegro.id)!;
    // 500 piezas × 0,61 kg = 305 kg → 4 cargas de 100 kg.
    const m = materialParaPiezas(500, 0.61, r.REGIMEN!, r.ARRANQUE!)!;
    expect(m.cargas).toBe(4);
    expect(m.porMp.get(s.materiaPrima.copo2240.id)!.kg).toBe(400);
    // Arranque 600 + 750 g y 3 de régimen × 1.200 g.
    expect(m.porMp.get(masterId)!.kg).toBe(4.95);
  });
});

describe("Planificación agrupada por producto y color", () => {
  let p1: { id: number; lineaId: number };
  let p2: { id: number; lineaId: number };
  let p3: { id: number; lineaId: number };
  let tandaId: number;

  it("agrupa los pedidos pendientes por producto, descuenta el stock y avisa la entrega próxima", async () => {
    p1 = await pedido(s.productos.rejNegro.id, 300, "2026-10-01", "2026-10-17");
    p2 = await pedido(s.productos.rejNegro.id, 200, "2026-10-02", "2026-11-30");
    p3 = await pedido(s.productos.rejRojo.id, 400, "2026-10-03");
    const grupos = await gruposParaPlanificar("2026-10-16");
    const negro = grupos.find((g) => g.productoId === s.productos.rejNegro.id)!;
    expect(negro).toMatchObject({ pendiente: 500, stock: 0, faltante: 500, aPlanificar: 500, colorNombre: "Negro", matriz: "Rejilla", tieneReceta: true });
    expect(negro.lineas.map((l) => l.pedidoId)).toEqual([p1.id, p2.id]);
    expect(negro.alerta?.texto).toBe("Hay que entregar mañana");
    const rojo = grupos.find((g) => g.productoId === s.productos.rejRojo.id)!;
    // Stock de rojo 168: el faltante es lo que no cubre.
    expect(rojo).toMatchObject({ pendiente: 400, stock: 168, faltante: 232 });
    expect(alertaEntrega("2026-10-10", "2026-10-16")?.nivel).toBe("vencida");
  });

  it("arma una tanda con los pedidos elegidos y extra para stock; no deja planificar dos veces lo mismo", async () => {
    const r = await crearTanda(s.usuarios.ENCARGADO, {
      productoId: s.productos.rejNegro.id,
      lineas: [
        { pedidoLineaId: p1.lineaId, cantidad: 300 },
        { pedidoLineaId: p2.lineaId, cantidad: 200 },
      ],
      cantidadStock: 100,
    });
    expect(r.error).toBeUndefined();
    tandaId = r.id!;
    const doble = await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejNegro.id, lineas: [{ pedidoLineaId: p1.lineaId, cantidad: 1 }] });
    expect(doble.error).toMatch(/sin planificar/);
    const [t] = await listarTandas();
    expect(t).toMatchObject({ id: tandaId, objetivo: 600, cantidadPedidos: 500, cantidadStock: 100, inyectora: "8" });
    expect(t.pedidos.map((p) => p.pedidoId)).toEqual([p1.id, p2.id]);
    expect((await gruposParaPlanificar()).find((g) => g.productoId === s.productos.rejNegro.id)!.aPlanificar).toBe(0);
    expect((await crearTanda(s.usuarios.OPERARIO, { productoId: s.productos.rejNegro.id, lineas: [], cantidadStock: 10 })).error).toMatch(/permiso/);
  });

  it("corta la tanda (el pedido vuelve a planificar), la reordena y la posterga con motivo", async () => {
    expect((await quitarPedidosDeTanda(s.usuarios.ENCARGADO, tandaId, [p2.lineaId], "Se entrega la semana próxima")).error).toBeUndefined();
    const g = (await gruposParaPlanificar()).find((x) => x.productoId === s.productos.rejNegro.id)!;
    expect(g.aPlanificar).toBe(200);
    const rojo = await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejRojo.id, lineas: [{ pedidoLineaId: p3.lineaId, cantidad: 232 }] });
    expect((await moverTanda(s.usuarios.ENCARGADO, rojo.id!, "arriba")).error).toBeUndefined();
    let tandas = await listarTandas();
    expect(tandas.map((t) => t.id)).toEqual([rojo.id, tandaId]);
    // Rojo antes que negro en la misma máquina: el negro avisa cambio de color.
    expect(tandas[1].avisos.join(" ")).toMatch(/Cambio de color: Rojo → Negro/);
    expect((await postergarTanda(s.usuarios.ENCARGADO, rojo.id!, null)).error).toMatch(/motivo/);
    expect((await postergarTanda(s.usuarios.ENCARGADO, rojo.id!, "Falta master rojo")).error).toBeUndefined();
    tandas = await listarTandas();
    expect(tandas.find((t) => t.id === rojo.id)!.estado).toBe("POSTERGADA");
  });

  it("producción sólo para stock, sin pedido", async () => {
    const r = await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.ciegoNegro.id, lineas: [], cantidadStock: 50 });
    expect(r.error).toBeUndefined();
    const t = (await listarTandas()).find((x) => x.id === r.id)!;
    expect(t).toMatchObject({ objetivo: 50, cantidadPedidos: 0, pedidos: [] });
    expect(t.avisos.join(" ")).toMatch(/Sin receta/);
  });

  it("alerta de compra: el material que pide la planificación contra depósito + pie de máquina", async () => {
    // Tanda negro: 300 para pedidos + 100 para stock = 400 piezas × 0,61 = 244 kg
    // → 3 cargas: 300 kg de copolímero; master = arranque (1.350 g) + 2 × 1.200 g.
    await actualizarTanda(s.usuarios.ENCARGADO, tandaId, { usarArranque: true });
    const nec = await necesidadDeCompra();
    const master = nec.find((n) => n.materiaPrimaId === masterId)!;
    expect(master.requeridoKg).toBe(3.75);
    expect(master.faltanteKg).toBe(0);
    const copo = nec.find((n) => n.materiaPrimaId === s.materiaPrima.copo2240.id)!;
    expect(copo.requeridoKg).toBe(300);
    // Con un pedido grande de negro el master no alcanza: se avisa el faltante.
    const grande = await pedido(s.productos.rejNegro.id, 5000, "2026-10-04");
    const t2 = await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejNegro.id, lineas: [{ pedidoLineaId: grande.lineaId, cantidad: 5000 }] });
    const conGrande = (await necesidadDeCompra()).find((n) => n.materiaPrimaId === masterId)!;
    expect(conGrande.faltanteKg).toBeGreaterThan(0);
    await postergarTanda(s.usuarios.ENCARGADO, t2.id!, "Prueba de alerta de compra");
  });

  it("inicia la producción desde la tanda: pedidos, cantidad objetivo y partida precargados", async () => {
    const r = await iniciarProduccionDeTanda(s.usuarios.ENCARGADO, tandaId, { golpesInicio: 1000 });
    expect(r.error).toBeUndefined();
    const [c] = await db().select().from(schema.cicloProduccion).where(eq(schema.cicloProduccion.id, r.cicloId!));
    expect(c).toMatchObject({ tandaId, cantidadDeseada: 400, inyectora: "8", golpesInicio: 1000 });
    expect(c.partidaId).not.toBeNull();
    const ped = await db().select().from(schema.cicloPedido).where(eq(schema.cicloPedido.cicloId, c.id));
    expect(ped).toEqual([expect.objectContaining({ pedidoId: p1.id, cantidadAsignada: 300 })]);
    expect((await listarTandas()).find((t) => t.id === tandaId)!.estado).toBe("EN_CURSO");
    expect((await iniciarProduccionDeTanda(s.usuarios.ENCARGADO, tandaId, { golpesInicio: 1000 })).error).toMatch(/ya está en producción/);
  });
});

describe("Operario: turno, receta, relevo y stock por ubicación", () => {
  let cicloId: number;
  let retiroId: number;

  it("el retiro traslada del depósito al pie de máquina sin cambiar el total", async () => {
    const vista = await vistaTaller("8");
    cicloId = vista.produccion!.cicloId;
    const totalAntes = await totalMp(s.materiaPrima.copo2240.id);
    const depAntes = await saldoMp(s.materiaPrima.copo2240.id, ubic.deposito);
    const r = await registrarRetiroMaquina(s.usuarios.RETIROS_MP, {
      cicloId,
      lineas: [
        { materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: null, cantidadKg: 300 },
        { materiaPrimaId: masterId, loteMpId: null, cantidadKg: 4.8 },
      ],
    });
    expect(r.error).toBeUndefined();
    retiroId = r.id!;
    expect(await saldoMp(s.materiaPrima.copo2240.id, ubic.deposito)).toBe(depAntes - 300);
    expect(await saldoMp(s.materiaPrima.copo2240.id, ubic.pie)).toBe(300);
    expect(await totalMp(s.materiaPrima.copo2240.id)).toBe(totalAntes);
    const v = await vistaTaller("8");
    expect(v.pie.find((m) => m.materiaPrimaId === s.materiaPrima.copo2240.id)).toMatchObject({ kg: 300, bolsas: "12 bolsas de 25 kg" });
    expect(v.pie.find((m) => m.materiaPrimaId === masterId)).toMatchObject({ kg: 4.8, bolsas: "8 bolsitas de 600 g" });
  });

  it("sin turno no se carga; tomado el turno, la receta de arranque se carga con un toque y una sola vez", async () => {
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN" })).error).toMatch(/Tomá el turno/);
    expect((await tomarTurno(s.usuarios.OPERARIO, { cicloId, turno: "NOCHE", operarioNombre: "Juan" })).error).toBeUndefined();
    let v = await vistaTaller("8");
    expect(v.produccion!.usarArranque).toBe(true);
    expect(v.produccion!.turnoAbierto).toMatchObject({ golpesInicio: 1000, operarioNombre: "Juan" });
    const a = await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "ARRANQUE", token: "arranque-1" });
    expect(a).toMatchObject({ kg: 101.35 });
    const repetida = await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "ARRANQUE", token: "arranque-1" });
    expect(repetida.repetido).toBe(true);
    expect(await saldoMp(s.materiaPrima.copo2240.id, ubic.pie)).toBe(200);
    expect(await saldoMp(s.materiaPrima.copo2240.id, ubic.proceso)).toBe(100);
    expect(await saldoMp(masterId, ubic.proceso)).toBe(1.35);
    v = await vistaTaller("8");
    expect(v.produccion!.usarArranque).toBe(false);
    expect(v.produccion!.tolva.find((m) => m.materiaPrimaId === masterId)!.kg).toBe(1.35);
  });

  it("una carga distinta de la receta exige motivo y queda visible; si falta material no carga nada", async () => {
    const ajustes = [
      { materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 2 },
      { materiaPrimaId: masterId, presentacionId: bolsita600, cantidad: 1 },
    ];
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN", ajustes })).error).toMatch(/motivo/);
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN", ajustes, motivoExcepcion: "Carga parcial (tolva llena)" })).error).toBeUndefined();
    const nov = await db().select().from(schema.novedadMaquina).where(eq(schema.novedadMaquina.tipo, "CARGA_DISTINTA"));
    expect(nov[0].motivo).toBe("Carga parcial (tolva llena)");
    const exc = await db().select().from(schema.movimientoMaquina).where(eq(schema.movimientoMaquina.motivoExcepcion, "Carga parcial (tolva llena)"));
    expect(exc.find((m) => Number(m.cantidad) === 50)).toMatchObject({ planificadoKg: "100.000" });
    // Quedan 150 kg de copolímero y 2,85 kg de master: dos recetas de régimen no entran.
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN" })).error).toBeUndefined();
    const sinMaterial = await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN" });
    expect(sinMaterial.error).toMatch(/A pie de máquina hay 50 kg/);
    expect(await saldoMp(s.materiaPrima.copo2240.id, ubic.pie)).toBe(50);
    expect((await registrarNovedad(s.usuarios.OPERARIO, { cicloId, tipo: "NO_CARGA", motivo: "Falta de material a pie de máquina" })).error).toBeUndefined();
  });

  it("cierre de turno: golpes y descarte; el turno siguiente verifica el material y registra la diferencia", async () => {
    expect((await cerrarTurno(s.usuarios.OPERARIO, { cicloId, golpesFin: 900 })).error).toMatch(/no pueden ser menores/);
    const c = await cerrarTurno(s.usuarios.OPERARIO, { cicloId, golpesFin: 1250, descarteKg: 6.1, motivoInterrupcion: "Sin interrupciones" });
    expect(c).toMatchObject({ piezas: 250 });
    let v = await vistaTaller("8");
    expect(v.produccion).toMatchObject({ producido: 250, falta: 150, turnoAbierto: null });
    expect(v.produccion!.ultimoTurno).toMatchObject({ golpesFin: 1250, piezas: 250 });
    expect((await tomarTurno(s.usuarios.OPERARIO, { cicloId, turno: "MANANA" })).error).toMatch(/Verificá el material/);
    expect((await tomarTurno(s.usuarios.OPERARIO, { cicloId, turno: "MANANA", recepcionOk: false })).error).toMatch(/motivo/);
    expect((await tomarTurno(s.usuarios.OPERARIO, { cicloId, turno: "MANANA", recepcionOk: false, recepcionMotivo: "Faltan bolsas", recepcionDetalle: "Falta una bolsita de master" })).error).toBeUndefined();
    v = await vistaTaller("8");
    expect(v.produccion!.turnoAbierto).toMatchObject({ golpesInicio: 1250, recepcionOk: false });
    const dif = await db().select().from(schema.novedadMaquina).where(eq(schema.novedadMaquina.tipo, "DIFERENCIA_RELEVO"));
    expect(dif[0]).toMatchObject({ motivo: "Faltan bolsas", detalle: "Falta una bolsita de master" });
  });

  it("material virgen devuelto vuelve al depósito; lo mezclado sale de la tolva como sobrante con su código", async () => {
    const depAntes = await saldoMp(s.materiaPrima.copo2240.id, ubic.deposito);
    expect((await devolverADeposito(s.usuarios.RETIROS_MP, { retiroMpId: (await obtenerRetirosMaquina({ ids: [retiroId] }))[0].lineas[0].id, cantidadKg: 50 })).error).toBeUndefined();
    expect(await saldoMp(s.materiaPrima.copo2240.id, ubic.deposito)).toBe(depAntes + 50);
    expect(await saldoMp(s.materiaPrima.copo2240.id, ubic.pie)).toBe(0);
    const procesoAntes = await saldoMp(s.materiaPrima.copo2240.id, ubic.proceso);
    expect((await registrarSobrante(s.usuarios.RETIROS_MP, { retiroMaquinaId: retiroId, materiaPrimaDestinoId: sobranteId, cantidadKg: 10.1 })).error).toBeUndefined();
    expect(await saldoMp(sobranteId, ubic.deposito)).toBe(10.1);
    // Sale de la tolva en la proporción de lo cargado (250 kg copolímero / 3,15 kg master).
    expect(await saldoMp(s.materiaPrima.copo2240.id, ubic.proceso)).toBeCloseTo(procesoAntes - 9.975, 3);
  });

  it("cierre de producción: consume la tolva, entra a stock lo bueno y la tanda queda completada", async () => {
    const stockAntes = await stockProd(s.productos.rejNegro.id);
    const r = await cerrarProduccionTaller(s.usuarios.OPERARIO, { cicloId, golpesFin: 1400, descarteKg: 0, rebarbaKg: 1.5 });
    expect(r.error).toBeUndefined();
    // 400 piezas producidas, 10 de descarte (6,1 kg ÷ 0,61) → 390 a stock.
    expect(r.piezasAStock).toBe(390);
    expect(await stockProd(s.productos.rejNegro.id)).toBe(stockAntes + 390);
    expect(await saldoMp(s.materiaPrima.copo2240.id, ubic.proceso)).toBe(0);
    expect(await saldoMp(masterId, ubic.proceso)).toBe(0);
    const consumo = await db().select().from(schema.movimiento).where(and(eq(schema.movimiento.origen, "CONSUMO"), eq(schema.movimiento.origenId, cicloId)));
    expect(consumo.reduce((t, m) => t + Number(m.cantidad), 0)).toBeCloseTo(253.15 - 10.1, 3);
    const [t] = await db().select().from(schema.tanda).where(eq(schema.tanda.cicloId, cicloId));
    expect(t.estado).toBe("COMPLETADA");
    expect((await vistaTaller("8")).produccion).toBeNull();
  });

  it("conciliación: el retiro cierra con la diferencia de balanza como ajuste del pie de máquina", async () => {
    const [r] = await obtenerRetirosMaquina({ ids: [retiroId] });
    const master = r.lineas.find((l) => l.materiaPrimaId === masterId)!;
    expect(master.saldo.pie).toBe(1.65);
    expect((await cerrarRetiro(s.usuarios.RETIROS_MP, retiroId, { [master.id]: "Bolsitas devueltas en otra entrega" })).error).toBeUndefined();
    expect(await saldoMp(masterId, ubic.pie)).toBe(0);
    const aj = await db().select().from(schema.movimiento).where(eq(schema.movimiento.origen, "DIFERENCIA_BALANZA"));
    expect(Number(aj[0].cantidad)).toBe(-1.65);
  });

  it("una carga anulada por Supervisión con la producción cerrada reaparece a pie de máquina", async () => {
    const [carga] = await db().select().from(schema.movimientoMaquina).where(and(eq(schema.movimientoMaquina.cicloId, cicloId), eq(schema.movimientoMaquina.tipo, "CARGA_TOLVA")));
    expect((await anularMovimientoMaquina(s.usuarios.ENCARGADO, carga.id, "x")).error).toMatch(/Supervisión/);
    expect((await anularMovimientoMaquina(s.usuarios.GERENCIA, carga.id, "Carga duplicada en la planilla")).error).toBeUndefined();
    expect(await saldoMp(s.materiaPrima.copo2240.id, ubic.pie)).toBe(Number(carga.cantidad));
  });

  it("permisos: Despacho no opera la máquina; el operario no planifica", async () => {
    expect((await tomarTurno(s.usuarios.DESPACHO, { cicloId, turno: "TARDE" })).error).toMatch(/permiso/);
    expect((await moverTanda(s.usuarios.OPERARIO, 1, "abajo")).error).toMatch(/permiso/);
  });
});
