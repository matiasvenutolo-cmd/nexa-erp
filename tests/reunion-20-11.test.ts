/**
 * Reunión 20/11/2026 con NEXA y notas de prueba del socio: etiquetas al
 * terminar la producción, lista «Para llevar a pie de máquina», material que
 * sobró de la producción anterior, tope de 4 bolsas por carga, esquema de
 * turnos en la planificación, ingreso de materia prima atado a su compra y
 * avisos entre Compras y Materia prima.
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
import { crearTanda } from "@/lib/data/planificacion";
import { guardarReceta, listarPresentaciones } from "@/lib/data/recetas";
import { cargarReceta, cerrarProduccionTaller, iniciarTandaAsignada, pausarProduccion, relevosRecientes, revisarTurno, turnosSinRevisar, vistaTaller } from "@/lib/data/taller";
import { devolverADeposito, obtenerRetirosMaquina, registrarRetiroMaquina } from "@/lib/data/maquina";
import { paraLlevarAPie } from "@/lib/data/llevar-mp";
import { etiquetasDe, produccionesConCajas } from "@/lib/data/produccion";
import { guardarEsquema } from "@/lib/data/turnos";
import { ejecutarCompra, listarCompras, solicitarCompra } from "@/lib/data/compras";
import { guardarProveedor } from "@/lib/data/proveedores";
import { ingresarMateriaPrima } from "@/lib/data/materia-prima";
import { listarAvisos } from "@/lib/data/avisos";
import { crearPedido, situacionPedidos } from "@/lib/data/pedidos";
import { hoyISO, sumarDias } from "@/lib/format";
import { fmtPeso } from "@/lib/presentaciones";
import { turnoFueraDeEsquema } from "@/lib/turnos";

let s: Semilla;
const db = () => holder.db!;
const hoy = hoyISO();
let masterId: number;
let bolsa25: number;
let bolsita600: number;

beforeAll(async () => {
  s = await sembrar(await abrirBase());
  const [master] = await db().insert(schema.materiaPrima).values({ codigoInterno: "24", nombre: "24-Master negro 951", tipo: "MASTER" }).returning();
  masterId = master.id;
  await db().insert(schema.saldo).values({ depositoId: s.deposito.id, materiaPrimaId: masterId, cantidad: "10" });
  const pres = await listarPresentaciones();
  bolsa25 = pres.find((p) => p.nombre === "Bolsa 25 kg")!.id;
  bolsita600 = pres.find((p) => p.nombre === "Bolsita 600 g")!.id;
  // Negro: 4 bolsas de copolímero + 2 bolsitas de master. Rojo: sólo copolímero.
  await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejNegro.id, "REGIMEN", {
    items: [
      { materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 4 },
      { materiaPrimaId: masterId, presentacionId: bolsita600, cantidad: 2 },
    ],
  });
  await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejRojo.id, "REGIMEN", { items: [{ materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 4 }] });
});
afterAll(cerrarBase);

describe("Para llevar a pie de máquina, producción y etiquetas", () => {
  let tandaNegro: number;
  let cicloNegro: number;

  it("Materia prima ve lo que hay que llevar para toda la tanda, en bolsas enteras", async () => {
    // 200 piezas × 0,61 kg = 122 kg → 2 cargas: 8 bolsas de 25 kg y 4 bolsitas de 600 g.
    tandaNegro = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejNegro.id, lineas: [], cantidadStock: 200, fecha: hoy, turno: "NOCHE" })).id!;
    let l = (await paraLlevarAPie()).find((x) => x.tandaId === tandaNegro)!;
    expect(l).toMatchObject({ dia: "hoy", inyectora: "8", piezas: 200, completa: false });
    expect(l.materiales.map((m) => m.texto)).toEqual(["8 bolsas de 25 kg", "4 bolsitas de 600 g"]);
    // Se lleva una parte: falta el resto.
    await registrarRetiroMaquina(s.usuarios.MATERIA_PRIMA, { cicloId: null, tandaId: tandaNegro, lineas: [{ materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: null, cantidadKg: 150 }] });
    l = (await paraLlevarAPie()).find((x) => x.tandaId === tandaNegro)!;
    expect(l.materiales.find((m) => m.materiaPrimaId === s.materiaPrima.copo2240.id)!.texto).toBe("2 bolsas de 25 kg");
    await registrarRetiroMaquina(s.usuarios.MATERIA_PRIMA, {
      cicloId: null,
      tandaId: tandaNegro,
      lineas: [
        { materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: null, cantidadKg: 50 },
        { materiaPrimaId: masterId, loteMpId: null, cantidadKg: 2.4 },
      ],
    });
    expect((await paraLlevarAPie()).find((x) => x.tandaId === tandaNegro)!.completa).toBe(true);
  });

  it("el operario carga hasta 4 bolsas por carga (lo que entra en el mezclador)", async () => {
    const r = await iniciarTandaAsignada(s.usuarios.OPERARIO, { tandaId: tandaNegro, golpesInicio: 0, turno: "NOCHE" });
    expect(r.error).toBeUndefined();
    cicloNegro = r.cicloId!;
    const cinco = [
      { materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa25, cantidad: 5 },
      { materiaPrimaId: masterId, presentacionId: bolsita600, cantidad: 2 },
    ];
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId: cicloNegro, tipo: "REGIMEN", ajustes: cinco, motivoExcepcion: "Otro" })).error).toMatch(/hasta 4 bolsas/);
    expect((await cargarReceta(s.usuarios.OPERARIO, { cicloId: cicloNegro, tipo: "REGIMEN" })).error).toBeUndefined();
  });

  it("la pausa queda con su duración en las novedades", async () => {
    expect((await pausarProduccion(s.usuarios.OPERARIO, { cicloId: cicloNegro, motivo: "Máquina detenida o rota" })).error).toBeUndefined();
    let n = (await relevosRecientes()).novedades.find((x) => x.n.motivo.startsWith("Pausa:"))!;
    expect(n.finPausa).toBeNull();
    expect((await pausarProduccion(s.usuarios.OPERARIO, { cicloId: cicloNegro, motivo: null, reanudar: true })).error).toBeUndefined();
    n = (await relevosRecientes()).novedades.find((x) => x.n.motivo.startsWith("Pausa:"))!;
    expect(n.finPausa).not.toBeNull();
  });

  it("al terminar la producción salen sus cajas para imprimir, y aparecen en el menú Etiquetas", async () => {
    const r = await cerrarProduccionTaller(s.usuarios.OPERARIO, { cicloId: cicloNegro, golpesFin: 100, descartePiezas: 0 });
    expect(r).toMatchObject({ piezasAStock: 100, cajas: 4 });
    expect(await etiquetasDe({ cicloId: cicloNegro })).toHaveLength(4);
    const menu = await produccionesConCajas({ desde: sumarDias(hoy, -1), hasta: hoy, texto: "negro" });
    expect(menu.find((p) => p.cicloId === cicloNegro)).toMatchObject({ cajas: 4, piezas: 100 });
    expect(await produccionesConCajas({ desde: sumarDias(hoy, -1), hasta: hoy, texto: "rojo" })).toHaveLength(0);
  });

  it("el número de Relevos cuenta sólo los turnos que pasaron cajas a stock", async () => {
    expect(await turnosSinRevisar()).toBe(1);
    const [t] = await db().select().from(schema.turnoProduccion).where(eq(schema.turnoProduccion.cicloId, cicloNegro));
    expect((await revisarTurno(s.usuarios.ENCARGADO, t.id)).error).toBeUndefined();
    expect(await turnosSinRevisar()).toBe(0);
  });

  it("lo que sobró de la producción anterior pasa a la siguiente si es de su receta; si no, lo devuelve Materia prima", async () => {
    // Quedaron 100 kg de copolímero y 1,2 kg de master negro junto a la inyectora 8.
    const rojo = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejRojo.id, lineas: [], cantidadStock: 100, fecha: hoy, turno: "NOCHE" })).id!;
    const vista = await vistaTaller("8");
    const t = vista.asignadas.find((x) => x.id === rojo)!;
    expect(t.restoAnterior.map((m) => m.materiaPrimaId)).toEqual([s.materiaPrima.copo2240.id]);
    expect(t.restoAjeno.map((m) => m.materiaPrimaId)).toEqual([masterId]);
    // La lista «Para llevar» ya cuenta el copolímero que quedó: 100 piezas = 1 carga = 4 bolsas.
    expect((await paraLlevarAPie()).find((x) => x.tandaId === rojo)!.completa).toBe(true);
    const bloqueada = await iniciarTandaAsignada(s.usuarios.OPERARIO, { tandaId: rojo, golpesInicio: 100, turno: "NOCHE" });
    expect(bloqueada.error).toMatch(/Master negro 951 de la producción anterior, que no es de esta receta/);
    // Materia prima devuelve el master: ahora arranca y el copolímero pasa a esta producción.
    const [ret] = (await obtenerRetirosMaquina({ estado: "ABIERTO", inyectora: "8" })).filter((x) => x.lineas.some((l) => l.materiaPrimaId === masterId && l.saldo.pie > 0));
    const linea = ret.lineas.find((l) => l.materiaPrimaId === masterId)!;
    expect((await devolverADeposito(s.usuarios.MATERIA_PRIMA, { retiroMpId: linea.id, cantidadKg: linea.saldo.pie })).error).toBeUndefined();
    const r = await iniciarTandaAsignada(s.usuarios.OPERARIO, { tandaId: rojo, golpesInicio: 100, turno: "NOCHE" });
    expect(r.error).toBeUndefined();
    const v = await vistaTaller("8");
    expect(v.produccion!.cicloId).toBe(r.cicloId);
    expect(v.pie.find((m) => m.materiaPrimaId === s.materiaPrima.copo2240.id)!.kg).toBe(100);
  });
});

describe("Turnos según el esquema del día", () => {
  it("con esquema simple no se puede planificar en el turno noche", async () => {
    const manana = sumarDias(hoy, 1);
    expect((await guardarEsquema(s.usuarios.ENCARGADO, [manana], "SIMPLE")).error).toBeUndefined();
    const noche = await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejBlanco.id, lineas: [], cantidadStock: 10, fecha: manana, turno: "NOCHE" });
    expect(noche.error).toMatch(/esquema simple \(7 a 16\): no hay turno noche/);
    expect((await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejBlanco.id, lineas: [], cantidadStock: 10, fecha: manana, turno: "MANANA" })).error).toBeUndefined();
    // Sin esquema cargado no se valida.
    expect(turnoFueraDeEsquema(manana, "NOCHE", null)).toBeNull();
  });
});

describe("Ingreso de materia prima atado a su compra y avisos", () => {
  it("Compras ejecuta el pedido y Materia prima recibe el aviso con la fecha de llegada", async () => {
    const prov = (await guardarProveedor(s.usuarios.COMPRAS, null, { nombre: "Berma" })).id!;
    const pedido = (await solicitarCompra(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: masterId, cantidadKg: 2 })).id!;
    expect((await ejecutarCompra(s.usuarios.COMPRAS, pedido, { proveedorId: prov, fechaEntregaEstimada: sumarDias(hoy, 5) })).error).toBeUndefined();
    const avisos = await listarAvisos("MATERIA_PRIMA");
    expect(avisos.some((a) => a.tipo === "COMPRA_MP" && /pidió 2 kg de 24-Master negro 951 a Berma: llega el/.test(a.mensaje))).toBe(true);
  });

  it("con una compra abierta, el ingreso tiene que decir de qué compra es; con la compra toma el proveedor y la cierra", async () => {
    const [c] = (await listarCompras({ abiertas: true })).filter((x) => x.materiaPrimaId === masterId);
    const base = { materiaPrimaId: masterId, fechaRecepcion: hoy, cantidadKg: 2, conCertificado: false };
    const sinCompra = await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, { ...base, proveedor: "Berma", codigoBarra: "000002411111111000000000901" });
    expect(sinCompra.error).toMatch(/compra abierta \(#\d+\): elegí a cuál corresponde/);
    const conCompra = await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, { ...base, proveedor: "", compraId: c.id, codigoBarra: "000002411111111000000000902" });
    expect(conCompra.error).toBeUndefined();
    const [cerrada] = (await listarCompras()).filter((x) => x.id === c.id);
    expect(cerrada.estado).toBe("ENTREGADA");
    const [mov] = await db().select().from(schema.movimiento).where(and(eq(schema.movimiento.origen, "INGRESO_MP"), eq(schema.movimiento.loteMpId, conCompra.loteId!)));
    expect(mov.motivo).toMatch(/Berma · compra #/);
    expect((await listarAvisos("COMPRAS")).some((a) => a.tipo === "COMPRA_MP" && /registró el ingreso de 2 kg .* quedó «Entregada»/.test(a.mensaje))).toBe(true);
    // Sin compras abiertas, el ingreso sin compra se acepta (ej. stock inicial).
    expect((await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, { ...base, proveedor: "Berma", codigoBarra: "000002411111111000000000903" })).error).toBeUndefined();
  });
});

describe("Pedidos y pesos", () => {
  it("el pedido dice de qué producto falta producir", async () => {
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
      lineas: [{ productoId: s.productos.ciegoNegro.id, colorTexto: null, unidadesPedidas: 300 }],
    });
    if (!("id" in r)) throw new Error(r.error);
    const sit = (await situacionPedidos([r.id])).get(r.id)!;
    expect(sit.faltaProducir).toBe(70);
    expect(sit.faltaDetalle).toEqual([{ producto: "Moneda Negro (031B)", cantidad: 70 }]);
  });

  it("desde 1 kg el peso se muestra en kilos (1.875 g se leía como 1,875 kg)", () => {
    expect(fmtPeso(1.875, { gramos: true })).toBe("1,875 kg");
    expect(fmtPeso(0.375, { gramos: true })).toBe("375 g");
  });
});
