/**
 * «Listado mejoras NEXA»: pedidos (número automático, entrega por defecto,
 * prioridad en la carga, orden), armado (disponibilidad, caja completa,
 * primer control), existencias por caja, clientes, turno por horario y el
 * flujo nuevo del operario (inicia la tanda, carga en un paso desde pie de
 * máquina o stock general, pausa, cancela, finaliza con sobrante).
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
import { crearPedido, disponibilidadArmado, entregaPorDefecto, listarPedidos, situacionPedidos } from "@/lib/data/pedidos";
import { confirmarPrimerControl, existenciasProducto, iniciarDespacho, piquear } from "@/lib/data/despachos";
import { cerrarCiclo, crearCiclo } from "@/lib/data/produccion";
import { historialCliente, listarClientes } from "@/lib/data/clientes";
import { turnoDe } from "@/lib/turnos";
import { actualizarTanda, crearTanda, listarTandas } from "@/lib/data/planificacion";
import { guardarReceta, listarPresentaciones } from "@/lib/data/recetas";
import { cancelarProduccion, cargarReceta, cerrarProduccionTaller, cerrarTurno, enBolsas, eventosDe, iniciarTandaAsignada, pausarProduccion, vistaTaller } from "@/lib/data/taller";
import { registrarRetiroMaquina } from "@/lib/data/maquina";
import { actualizarDatosTecnicos } from "@/lib/data/catalogo";
import { listarAuditoria } from "@/lib/data/auditoria";

let s: Semilla;
const db = () => holder.db!;
const ubic = { pie: 0, proceso: 0 };
let masterId: number;
let sobranteId: number;

const base = (over: Partial<Parameters<typeof crearPedido>[0]> = {}) => ({
  clienteId: s.cliente.id,
  numeroOrden: null,
  fechaPedido: "2026-10-17",
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
  lineas: [{ productoId: s.productos.rejBlanco.id, colorTexto: null, unidadesPedidas: 10 }],
  ...over,
});
async function saldo(mpId: number, dep: number) {
  const [f] = await db().select().from(schema.saldo).where(and(eq(schema.saldo.materiaPrimaId, mpId), eq(schema.saldo.depositoId, dep)));
  return Number(f?.cantidad ?? 0);
}

beforeAll(async () => {
  await abrirBase();
  s = await sembrar(db());
  const deps = await db().select().from(schema.deposito);
  ubic.pie = deps.find((d) => d.nombre === "Pie de máquina")!.id;
  ubic.proceso = deps.find((d) => d.nombre === "Tolva / en proceso")!.id;
  const [m, sb] = await db()
    .insert(schema.materiaPrima)
    .values([
      { codigoInterno: "24", nombre: "24-Master negro 951", tipo: "MASTER" },
      { codigoInterno: "403", nombre: "403-sobrante copolímero c/ negro", tipo: "SOBRANTE" },
    ])
    .returning();
  masterId = m.id;
  sobranteId = sb.id;
  await db().insert(schema.saldo).values({ depositoId: s.deposito.id, materiaPrimaId: masterId, cantidad: "20" });
});
afterAll(async () => {
  await cerrarBase();
});

describe("Pedidos: alta", () => {
  it("N° de orden correlativo, seguro ante altas simultáneas", async () => {
    const [a, b, c] = await Promise.all([crearPedido(base()), crearPedido(base()), crearPedido(base())]);
    const ids = [a, b, c].map((r) => ("id" in r ? r.id : 0));
    const nums = (await db().select().from(schema.pedido)).filter((p) => ids.includes(p.id)).map((p) => Number(p.numeroOrden));
    expect(new Set(nums).size).toBe(3);
    expect(Math.max(...nums) - Math.min(...nums)).toBe(2);
  });

  it("sin fecha de entrega, queda una semana después del pedido; si se indica, se respeta", async () => {
    expect(entregaPorDefecto("2026-10-28")).toBe("2026-11-04");
    const r = await crearPedido(base({ fechaPedido: "2026-10-17" }));
    const [p] = await db().select().from(schema.pedido).where(eq(schema.pedido.id, "id" in r ? r.id : 0));
    expect(p.fechaEntregaPactada).toBe("2026-10-24");
    const r2 = await crearPedido(base({ fechaEntregaPactada: "2026-11-30" }));
    const [p2] = await db().select().from(schema.pedido).where(eq(schema.pedido.id, "id" in r2 ? r2.id : 0));
    expect(p2.fechaEntregaPactada).toBe("2026-11-30");
  });

  it("prioridad en la misma carga, con motivo y en el historial; un doble envío no crea dos pedidos", async () => {
    expect("error" in (await crearPedido(base({ prioridad: -2 })))).toBe(true);
    const r = await crearPedido(base({ prioridad: -2, motivoPrioridad: "Urgencia", token: "form-1" }));
    const repetido = await crearPedido(base({ prioridad: -2, motivoPrioridad: "Urgencia", token: "form-1" }));
    expect("id" in r && "id" in repetido && r.id === repetido.id).toBe(true);
    const [p] = await db().select().from(schema.pedido).where(eq(schema.pedido.id, "id" in r ? r.id : 0));
    expect(p.prioridad).toBe(-2);
    const h = await listarAuditoria({ entidad: "pedido", entidadId: p.id });
    expect(h[0]).toMatchObject({ campo: "prioridad", valorNuevo: "Urgente", motivo: "Urgencia" });
    expect((await db().select().from(schema.pedido).where(eq(schema.pedido.token, "form-1"))).length).toBe(1);
  });

  it("listado: lo más nuevo primero; también por cliente o por fecha de entrega", async () => {
    await crearPedido(base({ fechaPedido: "2026-12-01" }));
    const porFecha = await listarPedidos();
    expect(porFecha[0].fechaPedido).toBe("2026-12-01");
    const porEntrega = await listarPedidos(undefined, { orden: "entrega" });
    const fechas = porEntrega.map((p) => p.fechaEntregaPactada).filter(Boolean) as string[];
    expect([...fechas].sort()).toEqual(fechas);
    expect((await listarPedidos(undefined, { orden: "cliente" })).length).toBe(porFecha.length);
  });
});

describe("Armado: disponibilidad, caja completa y primer control", () => {
  let cajasBlanco: { codigoBarra: string; cantidad: number }[] = [];

  it("existencias por caja: completas y abiertas, desde las cajas reales", async () => {
    const c = await crearCiclo({ fecha: "2026-10-17", inyectora: "8", productoId: s.productos.rejNegro.id, operarioId: null, golpesInicio: 0, piezasPorGolpe: 1, cicloSegundos: null, modo: null, partidaId: null, pedidos: [], usuarioId: s.usuarios.ENCARGADO.id });
    if ("error" in c) throw new Error(c.error);
    await cerrarCiclo(c.id, { golpesFin: 43, piezasDescartadas: 0, piezasEntregadas: 43, coladaKg: null, rebarbaKg: null, scrapKg: null, cambioCicloCausa: null, observaciones: null, cerrarPartida: false, usuarioId: s.usuarios.ENCARGADO.id });
    const ex = (await existenciasProducto(s.productos.rejNegro.id))!;
    expect(ex.capacidad).toBe(25);
    expect(ex.cajas.map((x) => [x.disponible, x.completa])).toEqual([
      [25, true],
      [18, false],
    ]);
    cajasBlanco = ex.cajas.map((x) => ({ codigoBarra: x.codigo, cantidad: x.disponible }));
  });

  it("«Comenzar a armar»: completo, parcial con aviso, o deshabilitado si no hay nada", async () => {
    const parcial = await crearPedido(base({ lineas: [{ productoId: s.productos.rejNegro.id, colorTexto: null, unidadesPedidas: 50 }] }));
    const sin = await crearPedido(base({ lineas: [{ productoId: s.productos.rejNegro.id, colorTexto: null, unidadesPedidas: 10 }] }));
    const sit = await situacionPedidos(["id" in parcial ? parcial.id : 0, "id" in sin ? sin.id : 0]);
    const a = disponibilidadArmado(sit.get("id" in parcial ? parcial.id : 0));
    expect(a).toMatchObject({ disponible: true });
    expect(a.aviso).toMatch(/Se pueden armar 43 de 50 unidades; faltan 7 por producir/);
    // El stock ya está tomado por el pedido anterior (prioridad): no confunde existencia con asignado.
    expect(disponibilidadArmado(sit.get("id" in sin ? sin.id : 0))).toMatchObject({ disponible: false });
  });

  it("caja completa toma todas sus unidades; destildada exige la cantidad y no supera lo que tiene la caja", async () => {
    const [ped] = await db().select().from(schema.pedidoLinea).where(and(eq(schema.pedidoLinea.productoId, s.productos.rejNegro.id), eq(schema.pedidoLinea.unidadesPedidas, 50)));
    const d = await iniciarDespacho(s.usuarios.DESPACHO, ped.pedidoId);
    expect(d.error).toBeUndefined();
    expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: cajasBlanco[1].codigoBarra, cajaCompleta: false })).error).toMatch(/Indicá cuántas/);
    const mas = await piquear(s.usuarios.DESPACHO, d.id!, { codigo: cajasBlanco[1].codigoBarra, cajaCompleta: false, cantidad: 20 });
    expect(mas.alerta).toMatch(/tiene 18 unidades/);
    expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: s.productos.rejNegro.codigo, cajaCompleta: true })).error).toMatch(/código de producto/);
    expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: cajasBlanco[0].codigoBarra, cajaCompleta: true })).ok).toBeDefined();
    expect((await piquear(s.usuarios.DESPACHO, d.id!, { codigo: cajasBlanco[1].codigoBarra, cajaCompleta: false, cantidad: 5 })).ok).toBeDefined();
    const piq = await db().select().from(schema.piqueo).where(and(eq(schema.piqueo.despachoId, d.id!), eq(schema.piqueo.conAlerta, false)));
    expect(piq.map((p) => p.cantidad).sort((a, b) => a - b)).toEqual([5, 25]);
    // Primer control parcial: informa que quedó parcialmente armado.
    const pc = await confirmarPrimerControl(s.usuarios.DESPACHO, d.id!, "ok");
    expect(pc).toMatchObject({ parcial: true });
    const [p] = await db().select().from(schema.pedido).where(eq(schema.pedido.id, ped.pedidoId));
    expect(p.estado).toBe("LISTO_PARA_DESPACHAR");
    // La caja abierta quedó con 13.
    const ex = (await existenciasProducto(s.productos.rejNegro.id))!;
    expect(ex.cajas.map((x) => x.disponible)).toEqual([13]);
  });
});

describe("Clientes", () => {
  it("orden alfabético sin distinguir mayúsculas e historial de pedidos con productos y despachos", async () => {
    await db().insert(schema.cliente).values([{ nombre: "zeta obras" }, { nombre: "Alfa SRL" }, { nombre: "beta sa" }]);
    const nombres = (await listarClientes()).map((c) => c.nombre);
    expect(nombres.slice(0, 3)).toEqual(["Alfa SRL", "beta sa", "Carrefour"]);
    expect((await listarClientes(undefined, "za"))[0].nombre).toBe("zeta obras");
    const h = await historialCliente(s.cliente.id);
    expect(h.length).toBeGreaterThan(3);
    expect(h[0].lineas.length).toBeGreaterThan(0);
    expect(h.some((p) => p.despachos.length > 0)).toBe(true);
  });
});

describe("Turno según la hora", () => {
  it("sin horarios configurados no adivina; configurado, calcula el turno y la noche pertenece al día en que empezó", () => {
    expect(turnoDe(new Date("2026-10-17T12:00:00-03:00"), { MANANA: null, TARDE: 14, NOCHE: 22 })).toBeNull();
    const h = { MANANA: 6, TARDE: 14, NOCHE: 22 };
    expect(turnoDe(new Date("2026-10-17T08:30:00-03:00"), h)).toEqual({ turno: "MANANA", fecha: "2026-10-17" });
    expect(turnoDe(new Date("2026-10-17T14:00:00-03:00"), h)).toEqual({ turno: "TARDE", fecha: "2026-10-17" });
    expect(turnoDe(new Date("2026-10-17T23:10:00-03:00"), h)).toEqual({ turno: "NOCHE", fecha: "2026-10-17" });
    expect(turnoDe(new Date("2026-10-18T03:00:00-03:00"), h)).toEqual({ turno: "NOCHE", fecha: "2026-10-17" });
  });
});

describe("Operario: inicia la tanda, carga en un paso, pausa, cancela y finaliza", () => {
  let tandaId: number;
  let cicloId: number;
  let bolsa25: number;
  let b600: number;

  it("el Encargado asigna la tanda (calendario: día y turno persisten); sobrante en receta sólo si el producto lo admite", async () => {
    const pres = await listarPresentaciones();
    bolsa25 = pres.find((p) => p.nombre === "Bolsa 25 kg")!.id;
    b600 = pres.find((p) => p.nombre === "Bolsita 600 g")!.id;
    const conSobrante = await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejRojo.id, "REGIMEN", { items: [{ materiaPrimaId: sobranteId, presentacionId: (await listarPresentaciones()).find((p) => p.tipoMp === "VIRGEN")!.id, cantidad: 1 }] });
    expect(conSobrante.error).toBeDefined();
    expect((await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejRojo.id, "REGIMEN", { items: [{ materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 2 }, { materiaPrimaId: masterId, presentacionId: b600, cantidad: 1 }] })).error).toBeUndefined();
    const t = await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejRojo.id, lineas: [], cantidadStock: 100 });
    tandaId = t.id!;
    expect((await actualizarTanda(s.usuarios.ENCARGADO, tandaId, { fecha: "2026-10-17", turno: "TARDE" })).error).toBeUndefined();
    const [tv] = (await listarTandas()).filter((x) => x.id === tandaId);
    expect(tv).toMatchObject({ fecha: "2026-10-17", turno: "TARDE", inyectora: "8" });
    // Parámetro del producto: con «acepta sobrante» activado, la receta lo admite.
    expect((await actualizarDatosTecnicos(s.usuarios.ENCARGADO, s.productos.ciegoNegro.id, { m2PorUnidad: 0.16, kgPorUnidad: 0.61, aceptaSobrante: true })).error).toBeUndefined();
    const [bolson] = await db().insert(schema.presentacionMp).values({ tipoMp: "SOBRANTE", nombre: "Bolsa 25 kg", kg: "25" }).returning();
    expect((await guardarReceta(s.usuarios.ENCARGADO, s.productos.ciegoNegro.id, "REGIMEN", { items: [{ materiaPrimaId: sobranteId, presentacionId: bolson.id, cantidad: 1 }] })).error).toBeUndefined();
  });

  it("el operario inicia la tanda asignada con los golpes; sin horarios configurados pide el turno", async () => {
    expect((await iniciarTandaAsignada(s.usuarios.OPERARIO, { tandaId, golpesInicio: 500 })).error).toMatch(/horarios/);
    expect((await iniciarTandaAsignada(s.usuarios.DESPACHO, { tandaId, golpesInicio: 500, turno: "TARDE" })).error).toMatch(/permiso/);
    const r = await iniciarTandaAsignada(s.usuarios.OPERARIO, { tandaId, golpesInicio: 500, turno: "TARDE", operarioNombre: "Juan" });
    expect(r.error).toBeUndefined();
    cicloId = r.cicloId!;
    const v = await vistaTaller("8");
    expect(v.produccion).toMatchObject({ cicloId, piezasPorGolpe: 1, objetivo: 100 });
    expect(v.produccion!.turnoAbierto).toMatchObject({ turno: "TARDE", golpesInicio: 500, operarioNombre: "Juan", operarioId: s.usuarios.OPERARIO.id });
    expect((await eventosDe(cicloId))[0].e.tipo).toBe("INICIO");
  });

  it("carga en un paso: sin material a pie de máquina, destildando, se retira del stock general y se carga sin duplicar", async () => {
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN" })).error).toMatch(/A pie de máquina hay 0 kg/);
    const dep = await saldo(s.materiaPrima.copo2240.id, s.deposito.id);
    const r = await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN", usarPie: false, token: "carga-gral" });
    expect(r).toMatchObject({ kg: 50.6 });
    expect(await saldo(s.materiaPrima.copo2240.id, s.deposito.id)).toBe(dep - 50);
    expect(await saldo(s.materiaPrima.copo2240.id, ubic.pie)).toBe(0);
    expect(await saldo(s.materiaPrima.copo2240.id, ubic.proceso)).toBe(50);
    const [ret] = await db().select().from(schema.retiroMaquina).where(eq(schema.retiroMaquina.cicloId, cicloId));
    expect(ret).toMatchObject({ operarioId: s.usuarios.OPERARIO.id, entregaId: s.usuarios.OPERARIO.id });
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN", usarPie: false, token: "carga-gral" })).repetido).toBe(true);
    expect(await saldo(s.materiaPrima.copo2240.id, ubic.proceso)).toBe(50);
  });

  it("desde pie de máquina (por defecto); el código leído tiene que ser del material", async () => {
    await registrarRetiroMaquina(s.usuarios.RETIROS_MP, { cicloId, lineas: [{ materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: null, cantidadKg: 50 }, { materiaPrimaId: masterId, loteMpId: null, cantidadKg: 0.6 }] });
    const otroCodigo = await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN", codigos: [{ materiaPrimaId: masterId, codigo: "000" + "0".repeat(24) }] });
    expect(otroCodigo.error).toMatch(/no corresponde a ningún lote/);
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN" })).error).toBeUndefined();
    expect(await saldo(s.materiaPrima.copo2240.id, ubic.pie)).toBe(0);
    expect(await saldo(s.materiaPrima.copo2240.id, ubic.proceso)).toBe(100);
  });

  it("pausa con motivo bloquea la carga; reanudar; no se cancela con material en tolva", async () => {
    expect((await pausarProduccion(s.usuarios.OPERARIO, { cicloId, motivo: null })).error).toMatch(/motivo/);
    expect((await pausarProduccion(s.usuarios.OPERARIO, { cicloId, motivo: "Máquina detenida o rota" })).error).toBeUndefined();
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId, tipo: "REGIMEN", usarPie: false })).error).toMatch(/pausada/);
    expect((await pausarProduccion(s.usuarios.OPERARIO, { cicloId, motivo: null, reanudar: true })).error).toBeUndefined();
    expect((await cancelarProduccion(s.usuarios.OPERARIO, { cicloId, motivo: "error" })).error).toMatch(/material cargado en la tolva/);
    const ev = (await eventosDe(cicloId)).map((e) => e.e.tipo);
    expect(ev).toEqual(["INICIO", "PAUSA", "REANUDACION"]);
  });

  it("relevo: el cierre de turno guarda el material que queda; finalizar registra el sobrante y consume la tolva", async () => {
    expect((await cerrarTurno(s.usuarios.OPERARIO, { cicloId, golpesFin: 560, descarteKg: 0 })).error).toBeUndefined();
    const [t] = await db().select().from(schema.turnoProduccion).where(eq(schema.turnoProduccion.cicloId, cicloId));
    expect(t.materialAlCierre).toMatch(/En tolva: .*COPOLIMERO/);
    const r = await cerrarProduccionTaller(s.usuarios.OPERARIO, { cicloId, golpesFin: 560, sobrante: { materiaPrimaDestinoId: sobranteId, kg: 2 } });
    expect(r.error).toBeUndefined();
    expect(await saldo(sobranteId, s.deposito.id)).toBe(2);
    expect(await saldo(s.materiaPrima.copo2240.id, ubic.proceso)).toBe(0);
    const [tanda] = await db().select().from(schema.tanda).where(eq(schema.tanda.id, tandaId));
    expect(tanda.estado).toBe("COMPLETADA");
    expect((await eventosDe(cicloId)).at(-1)!.e.tipo).toBe("FINALIZACION");
  });

  it("cancelar una producción sin nada cargado: se cierra sin piezas y la tanda vuelve a planificar", async () => {
    const t = await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejRojo.id, lineas: [], cantidadStock: 30 });
    const r = await iniciarTandaAsignada(s.usuarios.OPERARIO, { tandaId: t.id!, golpesInicio: 560, turno: "NOCHE" });
    expect(r.error).toBeUndefined();
    expect((await cancelarProduccion(s.usuarios.OPERARIO, { cicloId: r.cicloId!, motivo: null })).error).toMatch(/motivo/);
    expect((await cancelarProduccion(s.usuarios.OPERARIO, { cicloId: r.cicloId!, motivo: "Cambio de matriz no previsto" })).error).toBeUndefined();
    const [c] = await db().select().from(schema.cicloProduccion).where(eq(schema.cicloProduccion.id, r.cicloId!));
    expect(c).toMatchObject({ cancelada: true, piezasEntregadas: 0 });
    const [td] = await db().select().from(schema.tanda).where(eq(schema.tanda.id, t.id!));
    expect(td).toMatchObject({ estado: "PLANIFICADA", cicloId: null });
  });

  it("no se inicia una producción en una máquina con material de otra producción a pie de máquina", async () => {
    await registrarRetiroMaquina(s.usuarios.RETIROS_MP, { cicloId: null, inyectora: "8", lineas: [{ materiaPrimaId: masterId, loteMpId: null, cantidadKg: 1 }] });
    // Retiro sin producción asociada: no bloquea (no se sabe de qué producto es).
    const t = await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejBlanco.id, lineas: [], cantidadStock: 10 });
    const c = await crearCiclo({ fecha: "2026-10-17", inyectora: "8", productoId: s.productos.rejNegro.id, operarioId: null, golpesInicio: 0, piezasPorGolpe: 1, cicloSegundos: null, modo: null, partidaId: null, pedidos: [], usuarioId: s.usuarios.ENCARGADO.id });
    if ("error" in c) throw new Error(c.error);
    await registrarRetiroMaquina(s.usuarios.RETIROS_MP, { cicloId: c.id, lineas: [{ materiaPrimaId: masterId, loteMpId: null, cantidadKg: 1 }] });
    await cerrarCiclo(c.id, { golpesFin: 0, piezasDescartadas: 0, piezasEntregadas: 0, coladaKg: null, rebarbaKg: null, scrapKg: null, cambioCicloCausa: null, observaciones: null, cerrarPartida: false, usuarioId: s.usuarios.ENCARGADO.id });
    const r = await iniciarTandaAsignada(s.usuarios.OPERARIO, { tandaId: t.id!, golpesInicio: 0, turno: "MANANA" });
    expect(r.error).toMatch(/material de otra producción/);
  });
});

describe("Stock a pie de máquina en bolsas", () => {
  const master = [
    { nombre: "Bolsita 600 g", kg: 0.6 },
    { nombre: "Bolsita 750 g", kg: 0.75 },
  ];
  it("elige la presentación que lo expresa exacto", () => {
    expect(enBolsas(1.2, master)).toBe("2 bolsitas de 600 g");
    expect(enBolsas(1.5, master)).toBe("2 bolsitas de 750 g");
    expect(enBolsas(50, [{ nombre: "Bolsa 25 kg", kg: 25 }])).toBe("2 bolsas de 25 kg");
  });
  it("si ninguna es exacta, muestra el resto en gramos", () => {
    expect(enBolsas(1.3, master)).toBe("1½ bolsitas de 750 g + 175 g");
    expect(enBolsas(0.1, master)).toBeNull();
  });
});
