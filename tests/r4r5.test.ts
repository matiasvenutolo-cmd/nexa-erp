/**
 * R4/R5 de punta a punta sobre PGlite con las migraciones reales:
 * materia prima con certificado y lote → producción con cajas → despacho
 * parcial con doble control → aviso a ventas → segundo despacho → cierre →
 * trazabilidad en los dos sentidos → reclamo con informe a gerencia.
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
import { asignarProductoALinea, cancelarPedido, crearPedido } from "@/lib/data/pedidos";
import { cerrarCiclo, crearCiclo } from "@/lib/data/produccion";
import { ingresarMateriaPrima, retirarMateriaPrima, separarCodigoLote } from "@/lib/data/materia-prima";
import {
  anularDespacho,
  confirmarControlFinal,
  confirmarPrimerControl,
  iniciarDespacho,
  listarDespachos,
  piquear,
  registrarRemitoLegal,
  situacionLineas,
} from "@/lib/data/despachos";
import { contarAvisosPendientes, listarAvisos, marcarAvisoProcesado, marcarAvisoVisto } from "@/lib/data/avisos";
import { pedidosDeCliente, trazarCaja, trazarCertificado, trazarLote, trazarPedido } from "@/lib/data/trazabilidad";
import { analizarReclamo, cerrarReclamo, crearReclamo, enviarInformeGerencia, obtenerReclamo } from "@/lib/data/reclamos";
import { listarAuditoria } from "@/lib/data/auditoria";

let s: Semilla;
const db = () => holder.db!;
const LOTE = `000${"0031"}${"12345678"}${"000000000777"}`;

async function stock(productoId: number) {
  const [f] = await db().select().from(schema.saldo).where(eq(schema.saldo.productoId, productoId));
  return Number(f.cantidad);
}

async function estadoPedido(id: number) {
  const [p] = await db().select({ estado: schema.pedido.estado }).from(schema.pedido).where(eq(schema.pedido.id, id));
  return p.estado;
}

function pedidoBase() {
  return {
    clienteId: s.cliente.id,
    fechaPedido: "2026-10-05",
    fechaEntregaPactada: "2026-10-20",
    numeroOrden: null,
    contacto: null,
    domicilioEntrega: null,
    modoEntrega: "Flete",
    requiereColocacion: false,
    metodoPago: null,
    total: null,
    senia: null,
    numeroComprobante: null,
    observaciones: null,
    usuarioId: s.usuarios.ADMINISTRACION.id,
  };
}

let pedidoId: number;
let cicloId: number;
let cajas: (typeof schema.caja.$inferSelect)[];

beforeAll(async () => {
  await abrirBase();
  s = await sembrar(db());
});

afterAll(async () => {
  await cerrarBase();
});

describe("R4 · Materia prima con certificado y lote", () => {
  it("valida el código de barras de 27 dígitos con los 3 primeros en 0", async () => {
    expect(separarCodigoLote("123")).toHaveProperty("error");
    const mal = await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, {
      materiaPrimaId: s.materiaPrima.copo2240.id,
      proveedor: "Petroquímica X",
      fechaRecepcion: "2026-10-01",
      cantidadKg: 100,
      codigoBarra: `001${LOTE.slice(3)}`,
      conCertificado: true,
    });
    expect(mal.error).toMatch(/3 primeros dígitos/);
  });

  it("ingresa el lote con su certificado correlativo y suma al stock", async () => {
    const antes = await db().select().from(schema.saldo).where(eq(schema.saldo.materiaPrimaId, s.materiaPrima.copo2240.id));
    const r = await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, {
      materiaPrimaId: s.materiaPrima.copo2240.id,
      proveedor: "Petroquímica X",
      fechaRecepcion: "2026-10-01",
      cantidadKg: 1000,
      codigoBarra: LOTE,
      conCertificado: true,
    });
    expect(r).toMatchObject({ certificado: 1 });
    const despues = await db().select().from(schema.saldo).where(eq(schema.saldo.materiaPrimaId, s.materiaPrima.copo2240.id));
    expect(Number(despues[0].cantidad) - Number(antes[0].cantidad)).toBe(1000);
    const dup = await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, {
      materiaPrimaId: s.materiaPrima.copo2240.id,
      proveedor: "Petroquímica X",
      fechaRecepcion: "2026-10-01",
      cantidadKg: 1,
      codigoBarra: LOTE,
      conCertificado: false,
    });
    expect(dup.error).toMatch(/Ya existe/);
  });

  it("un despachante no puede ingresar materia prima", async () => {
    const r = await ingresarMateriaPrima(s.usuarios.DESPACHO, {
      materiaPrimaId: s.materiaPrima.copo2240.id,
      proveedor: "X",
      fechaRecepcion: "2026-10-01",
      cantidadKg: 1,
      codigoBarra: `000${"9".repeat(24)}`,
      conCertificado: false,
    });
    expect(r.error).toMatch(/permiso/);
  });
});

describe("Pedido · producción · cajas", () => {
  it("crea el pedido multicolor: piso negro, esquinero negro y ciego negro", async () => {
    const r = await crearPedido({
      ...pedidoBase(),
      lineas: [
        { productoId: s.productos.rejNegro.id, colorTexto: "Negro", unidadesPedidas: 60 },
        { productoId: s.productos.esqNegro.id, colorTexto: "Negro", unidadesPedidas: 20 },
        { productoId: s.productos.ciegoNegro.id, colorTexto: "Negro", unidadesPedidas: 10 },
      ],
    });
    if (!("id" in r)) throw new Error(r.error);
    pedidoId = r.id;
  });

  it("producción del día: el retiro de MP queda vinculado al ciclo y al cerrar se generan cajas de 25", async () => {
    const c = await crearCiclo({
      fecha: "2026-10-05",
      inyectora: "8",
      productoId: s.productos.rejNegro.id,
      operarioId: null,
      golpesInicio: 1000,
      piezasPorGolpe: 1,
      cicloSegundos: null,
      modo: null,
      partidaId: null,
      pedidos: [{ pedidoId, cantidadAsignada: 60 }],
      usuarioId: s.usuarios.ENCARGADO.id,
    });
    cicloId = c.id;
    const [lote] = await db().select().from(schema.loteMp).where(eq(schema.loteMp.codigoBarra, LOTE));
    const retiro = await retirarMateriaPrima(s.usuarios.RETIROS_MP, {
      materiaPrimaId: s.materiaPrima.copo2240.id,
      loteMpId: lote.id,
      cantidadKg: 40,
      inyectora: "8",
      cicloId,
      entregaId: s.usuarios.MATERIA_PRIMA.id,
      observaciones: null,
    });
    expect(retiro.error).toBeUndefined();
    expect((await retirarMateriaPrima(s.usuarios.RETIROS_MP, { materiaPrimaId: s.materiaPrima.copo2240.id, loteMpId: lote.id, cantidadKg: 5000, inyectora: null, cicloId: null, entregaId: null, observaciones: null })).error).toMatch(/disponibles/);

    const sinStock = await cerrarCiclo(cicloId, {
      golpesFin: 1060,
      piezasDescartadas: 0,
      piezasEntregadas: null,
      coladaKg: null,
      rebarbaKg: null,
      scrapKg: null,
      cambioCicloCausa: null,
      observaciones: null,
      cerrarPartida: false,
      usuarioId: s.usuarios.ENCARGADO.id,
    });
    expect(sinStock.error).toMatch(/piezas que pasan a stock/);
    const demasiadas = await cerrarCiclo(cicloId, {
      golpesFin: 1060,
      piezasDescartadas: 0,
      piezasEntregadas: 61,
      coladaKg: null,
      rebarbaKg: null,
      scrapKg: null,
      cambioCicloCausa: null,
      observaciones: null,
      cerrarPartida: false,
      usuarioId: s.usuarios.ENCARGADO.id,
    });
    expect(demasiadas.error).toMatch(/no pueden superar/);

    const r = await cerrarCiclo(cicloId, {
      golpesFin: 1060,
      piezasDescartadas: 0,
      piezasEntregadas: 60,
      coladaKg: null,
      rebarbaKg: null,
      scrapKg: null,
      cambioCicloCausa: null,
      observaciones: null,
      cerrarPartida: false,
      usuarioId: s.usuarios.ENCARGADO.id,
    });
    expect(r.error).toBeUndefined();
    cajas = await db().select().from(schema.caja).where(eq(schema.caja.cicloId, cicloId));
    expect(cajas.map((c) => [c.codigoBarra, c.cantidad])).toEqual([
      ["P00001-C0001", 25],
      ["P00001-C0002", 25],
      ["P00001-C0003", 10],
    ]);
    expect(await stock(s.productos.rejNegro.id)).toBe(60);
  });
});

describe("R5 · Despacho parcial con doble control", () => {
  let despacho1: number;

  it("sólo los roles de despacho arman", async () => {
    expect((await iniciarDespacho(s.usuarios.OPERARIO, pedidoId)).error).toMatch(/permiso/);
    const r = await iniciarDespacho(s.usuarios.DESPACHO, pedidoId);
    expect(r.id).toBeDefined();
    despacho1 = r.id!;
    expect(await estadoPedido(pedidoId)).toBe("EN_ARMADO");
    expect((await iniciarDespacho(s.usuarios.DESPACHO, pedidoId)).error).toMatch(/en curso/);
  });

  it("piqueo de armado: cajas y producto sin caja; una lectura incorrecta queda registrada con alerta", async () => {
    expect((await piquear(s.usuarios.DESPACHO, despacho1, { codigo: cajas[0].codigoBarra })).ok).toBeDefined();
    // Releer una caja ya armada entera no suma 0 unidades en silencio: alerta.
    expect((await piquear(s.usuarios.DESPACHO, despacho1, { codigo: cajas[0].codigoBarra })).alerta).toMatch(/ya está armada/);
    for (const c of cajas.slice(1)) expect((await piquear(s.usuarios.DESPACHO, despacho1, { codigo: c.codigoBarra })).ok).toBeDefined();
    expect((await piquear(s.usuarios.DESPACHO, despacho1, { codigo: "011b-er-ne", cantidad: 10 })).ok).toBeDefined();
    const mal = await piquear(s.usuarios.DESPACHO, despacho1, { codigo: s.productos.rejRojo.codigo });
    expect(mal.alerta).toMatch(/no está en este pedido/);
    const doble = await piquear(s.usuarios.DESPACHO, despacho1, { codigo: cajas[0].codigoBarra });
    expect(doble.alerta).toBeDefined();
    const alertas = await db().select().from(schema.piqueo).where(eq(schema.piqueo.conAlerta, true));
    expect(alertas.length).toBe(3);
    expect(await db().select().from(schema.piqueo).where(and(eq(schema.piqueo.conAlerta, false), eq(schema.piqueo.cantidad, 0)))).toHaveLength(0);
    expect(alertas[0].usuarioId).toBe(s.usuarios.DESPACHO.id);
  });

  it("no se puede hacer el control final sin el primer control", async () => {
    expect((await confirmarControlFinal(s.usuarios.DESPACHO, despacho1)).error).toMatch(/primer control/);
  });

  it("primer control: registra quién y cuándo, deja el pedido listo y avisa a ventas", async () => {
    expect(await contarAvisosPendientes("ADMINISTRACION")).toBe(0);
    expect((await confirmarPrimerControl(s.usuarios.DESPACHO, despacho1, "Todo ok")).error).toBeUndefined();
    const [d] = await db().select().from(schema.despacho).where(eq(schema.despacho.id, despacho1));
    expect(d).toMatchObject({ estado: "CONTROLADO", control1PorId: s.usuarios.DESPACHO.id });
    expect(d.control1En).toBeInstanceOf(Date);
    expect(d.control1Resultado).toMatch(/Parcial/);
    expect(await estadoPedido(pedidoId)).toBe("LISTO_PARA_DESPACHAR");

    const avisos = await listarAvisos("ADMINISTRACION");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ tipo: "PEDIDO_LISTO", pedidoId, creadoPorNombre: "Usuario DESPACHO", vistoEn: null });
    expect(await contarAvisosPendientes("ADMINISTRACION")).toBe(1);
    expect(await contarAvisosPendientes("DESPACHO")).toBe(0);
  });

  it("aviso a ventas: queda persistido con visto/procesado y sólo lo gestiona su destinatario", async () => {
    const [a] = await listarAvisos("ADMINISTRACION");
    expect((await marcarAvisoVisto(s.usuarios.DESPACHO, a.id)).error).toBeDefined();
    await marcarAvisoVisto(s.usuarios.ADMINISTRACION, a.id);
    expect((await listarAvisos("ADMINISTRACION"))[0]).toMatchObject({ vistoPorNombre: "Usuario ADMINISTRACION" });
    await marcarAvisoProcesado(s.usuarios.ADMINISTRACION, a.id);
    expect(await contarAvisosPendientes("ADMINISTRACION")).toBe(0);
    expect((await listarAvisos("ADMINISTRACION", { incluirProcesados: true }))[0].procesadoPorNombre).toBe("Usuario ADMINISTRACION");
  });

  it("el control final tiene que coincidir con lo armado", async () => {
    await piquear(s.usuarios.ENCARGADO, despacho1, { codigo: cajas[0].codigoBarra });
    await piquear(s.usuarios.ENCARGADO, despacho1, { codigo: cajas[1].codigoBarra });
    expect((await confirmarControlFinal(s.usuarios.ENCARGADO, despacho1)).error).toMatch(/no coincide/);
    const ajena = await piquear(s.usuarios.ENCARGADO, despacho1, { codigo: "031B-PM-NE", cantidad: 5 });
    expect(ajena.alerta).toMatch(/no forma parte/);
  });

  it("entrega parcial: descuenta sólo lo que sale, asigna remito y el pedido queda abierto", async () => {
    await piquear(s.usuarios.ENCARGADO, despacho1, { codigo: cajas[2].codigoBarra });
    expect((await piquear(s.usuarios.ENCARGADO, despacho1, { codigo: cajas[2].codigoBarra })).alerta).toMatch(/ya fue controlado/);
    await piquear(s.usuarios.ENCARGADO, despacho1, { codigo: "011B-ER-NE", cantidad: 10 });
    const r = await confirmarControlFinal(s.usuarios.ENCARGADO, despacho1, "Retira el cliente");
    expect(r).toMatchObject({ remito: "R-000001" });

    expect(await estadoPedido(pedidoId)).toBe("PARCIALMENTE_DESPACHADO");
    expect(await stock(s.productos.rejNegro.id)).toBe(0);
    expect(await stock(s.productos.esqNegro.id)).toBe(633);
    expect(await stock(s.productos.ciegoNegro.id)).toBe(230); // pendiente: no se toca

    const lineas = await situacionLineas(pedidoId);
    expect(lineas.map((l) => [l.productoCodigo, l.entregado, l.pendiente])).toEqual([
      ["001B-PR-NE", 60, 0],
      ["011B-ER-NE", 10, 10],
      ["031B-PM-NE", 0, 10],
    ]);
    const salidas = (await db().select().from(schema.movimiento).where(eq(schema.movimiento.tipo, "SALIDA"))).filter((m) => m.productoId != null);
    expect(salidas.filter((m) => m.cajaId != null)).toHaveLength(3);
    expect(salidas.every((m) => m.usuarioId === s.usuarios.ENCARGADO.id)).toBe(true);
    const estados = await db().select({ e: schema.caja.estado }).from(schema.caja).where(eq(schema.caja.cicloId, cicloId));
    expect(estados.every((c) => c.e === "DESPACHADA")).toBe(true);
  });

  it("segundo despacho sin pedido nuevo, y el pedido se cierra cuando no queda nada", async () => {
    const d2 = (await iniciarDespacho(s.usuarios.DESPACHO, pedidoId)).id!;
    await piquear(s.usuarios.DESPACHO, d2, { codigo: "011B-ER-NE", cantidad: 10 });
    await piquear(s.usuarios.DESPACHO, d2, { codigo: "031B-PM-NE", cantidad: 10 });
    await confirmarPrimerControl(s.usuarios.DESPACHO, d2);
    const [d] = await db().select().from(schema.despacho).where(eq(schema.despacho.id, d2));
    expect(d.control1Resultado).toMatch(/Completo/);
    await piquear(s.usuarios.SUPERVISOR, d2, { codigo: "011B-ER-NE", cantidad: 10 });
    await piquear(s.usuarios.SUPERVISOR, d2, { codigo: "031B-PM-NE", cantidad: 10 });
    expect(await confirmarControlFinal(s.usuarios.SUPERVISOR, d2)).toMatchObject({ remito: "R-000002" });
    expect(await estadoPedido(pedidoId)).toBe("ENTREGADO");
    expect(await stock(s.productos.esqNegro.id)).toBe(623);
    expect(await stock(s.productos.ciegoNegro.id)).toBe(220);
    const historial = await listarDespachos(pedidoId);
    expect(historial.map((h) => [h.estado, h.numeroInterno])).toEqual([
      ["ENTREGADO", 2],
      ["ENTREGADO", 1],
    ]);
    const reservas = await db().select().from(schema.reserva);
    expect(reservas.every((r) => r.estado === "CONSUMIDA")).toBe(true);
  });

  it("remito legal: lo registra administración y queda asociado al despacho", async () => {
    const [d] = await listarDespachos(pedidoId);
    expect((await registrarRemitoLegal(s.usuarios.DESPACHO, d.id, "0001-00012345")).error).toMatch(/Administración/);
    expect((await registrarRemitoLegal(s.usuarios.ADMINISTRACION, d.id, "0001-00012345")).error).toBeUndefined();
    const [act] = await listarDespachos(pedidoId);
    expect(act).toMatchObject({ numeroRemito: "0001-00012345", numeroInterno: 2, remitoLegalPorNombre: "Usuario ADMINISTRACION" });
  });
});

describe("R4 · Trazabilidad en los dos sentidos", () => {
  it("lote → partida → cajas → cliente", async () => {
    const t = (await trazarLote(LOTE))!;
    expect(t.lote).toMatchObject({ certificadoNumero: 1, proveedor: "Petroquímica X" });
    expect(t.usos).toEqual([{ cicloId, kg: 40, partidaId: expect.any(Number) }]);
    expect(t.cajas).toHaveLength(3);
    expect(new Set(t.destinos.map((d) => d.clienteNombre))).toEqual(new Set(["Carrefour"]));
    expect(t.destinos.map((d) => d.cajaCodigo)).toEqual(["P00001-C0001", "P00001-C0002", "P00001-C0003"]);
  });

  it("cliente → pedido → caja → partida → lote → certificado", async () => {
    expect((await pedidosDeCliente("carre")).map((p) => p.pedidoId)).toContain(pedidoId);
    const t = (await trazarPedido(pedidoId))!;
    expect(t.entregas.filter((e) => e.cajaCodigo)).toHaveLength(3);
    expect(t.unidadesSinPartida).toBe(30); // esquineros y ciego del stock anterior a las cajas
    const material = t.origen[0].materiales[0];
    expect(material).toMatchObject({ loteCodigo: LOTE, certificadoNumero: 1, proveedor: "Petroquímica X", kg: 40 });
    expect(material.codigoUso).toBe(`001${LOTE.slice(3)}`); // los 3 dígitos se completan con el producto al inyectar
  });

  it("caja → pedido y certificado → lotes", async () => {
    const c = (await trazarCaja("p00001-c0003"))!;
    expect(c.destinos[0]).toMatchObject({ pedidoId, unidades: 10, remitoInterno: "R-000001" });
    expect(c.origen.numero).toBe(1);
    const cert = (await trazarCertificado(1))!;
    expect(cert.lotes[0].destinos.length).toBe(3);
  });
});

describe("Reclamos", () => {
  let reclamoId: number;

  it("ventas lo registra desde el pedido y el supervisor recibe el aviso", async () => {
    expect((await crearReclamo(s.usuarios.DESPACHO, { pedidoId, descripcion: "x" })).error).toMatch(/permiso/);
    const r = await crearReclamo(s.usuarios.ADMINISTRACION, {
      pedidoId,
      descripcion: "Llegaron baldosas con rebaba",
      motivoDevolucion: "MERCADERIA_FALLADA",
      cajaCodigo: "P00001-C0002",
    });
    reclamoId = r.id!;
    const rec = (await obtenerReclamo(reclamoId))!;
    expect(rec).toMatchObject({ estado: "ABIERTO", cajaCodigo: "P00001-C0002", partidaId: expect.any(Number), despachoId: expect.any(Number) });
    expect((await listarAvisos("SUPERVISOR"))[0]).toMatchObject({ tipo: "RECLAMO_NUEVO", reclamoId });
  });

  it("pasa obligatoriamente por el supervisor: causa, solución y cierre", async () => {
    expect((await analizarReclamo(s.usuarios.ENCARGADO, reclamoId, { causa: "x" })).error).toMatch(/supervisor/);
    expect((await cerrarReclamo(s.usuarios.SUPERVISOR, reclamoId)).error).toMatch(/causa y la solución/);
    await analizarReclamo(s.usuarios.SUPERVISOR, reclamoId, { causa: "Matriz con desgaste" });
    await analizarReclamo(s.usuarios.SUPERVISOR, reclamoId, { solucion: "Reposición de 2 cajas", observaciones: "Revisar matriz" });
    expect((await cerrarReclamo(s.usuarios.SUPERVISOR, reclamoId, "Cliente conforme")).error).toBeUndefined();
    const rec = (await obtenerReclamo(reclamoId))!;
    expect(rec).toMatchObject({ estado: "CERRADO", causa: "Matriz con desgaste", supervisorNombre: "Usuario SUPERVISOR" });
    expect(rec.eventos.map((e) => e.tipo)).toEqual(["CREADO", "ANALISIS", "CAUSA", "SOLUCION", "OBSERVACION", "CERRADO"]);
    expect((await analizarReclamo(s.usuarios.SUPERVISOR, reclamoId, { causa: "otra" })).error).toMatch(/cerrado/);
  });

  it("el informe llega a gerencia como aviso", async () => {
    expect((await enviarInformeGerencia(s.usuarios.ADMINISTRACION, reclamoId)).error).toBeDefined();
    expect((await enviarInformeGerencia(s.usuarios.SUPERVISOR, reclamoId)).error).toBeUndefined();
    const avisos = await listarAvisos("GERENCIA");
    expect(avisos.find((a) => a.tipo === "INFORME_RECLAMO")).toMatchObject({ reclamoId });
    expect((await obtenerReclamo(reclamoId))!.informeEnviadoEn).toBeInstanceOf(Date);
  });
});

describe("Anulación, cancelación y renglones históricos", () => {
  it("anular un despacho libera lo armado y conserva las lecturas", async () => {
    const r = await crearPedido({ ...pedidoBase(), lineas: [{ productoId: s.productos.rejBlanco.id, colorTexto: "Blanco", unidadesPedidas: 5 }] });
    if (!("id" in r)) throw new Error(r.error);
    const d = (await iniciarDespacho(s.usuarios.DESPACHO, r.id)).id!;
    await piquear(s.usuarios.DESPACHO, d, { codigo: "004A-PR-BL", cantidad: 5 });
    expect((await anularDespacho(s.usuarios.DESPACHO, d, "")).error).toMatch(/motivo/);
    expect((await anularDespacho(s.usuarios.DESPACHO, d, "Cliente cambió el día")).error).toBeUndefined();
    expect(await estadoPedido(r.id)).toBe("PEDIDO");
    expect(await db().select().from(schema.piqueo).where(eq(schema.piqueo.despachoId, d))).toHaveLength(1);
    expect(await stock(s.productos.rejBlanco.id)).toBe(520);

    // Cancelar el pedido con un despacho en curso anula el despacho y libera la reserva.
    const d2 = (await iniciarDespacho(s.usuarios.DESPACHO, r.id)).id!;
    expect((await cancelarPedido(s.usuarios.ADMINISTRACION, r.id)).error).toBeUndefined();
    const [desp] = await db().select().from(schema.despacho).where(eq(schema.despacho.id, d2));
    expect(desp.estado).toBe("ANULADO");
    const lineas = await db().select().from(schema.pedidoLinea).where(eq(schema.pedidoLinea.pedidoId, r.id));
    const [res] = await db().select().from(schema.reserva).where(eq(schema.reserva.pedidoLineaId, lineas[0].id));
    expect(res.estado).toBe("LIBERADA");
  });

  it("un renglón importado sin producto se asigna y queda reservado", async () => {
    const [p] = await db().insert(schema.pedido).values({ clienteId: s.cliente.id, fechaPedido: "2026-08-01" }).returning();
    const [l] = await db()
      .insert(schema.pedidoLinea)
      .values({ pedidoId: p.id, productoId: null, colorTexto: "Gris oscuro y amarillo", unidadesPedidas: 12 })
      .returning();
    expect((await iniciarDespacho(s.usuarios.DESPACHO, p.id)).error).toMatch(/producto asignado/);
    expect((await asignarProductoALinea(s.usuarios.DESPACHO, l.id, s.productos.rejRojo.id)).error).toMatch(/permiso/);
    expect((await asignarProductoALinea(s.usuarios.ADMINISTRACION, l.id, s.productos.rejRojo.id)).error).toBeUndefined();
    const [res] = await db().select().from(schema.reserva).where(and(eq(schema.reserva.pedidoLineaId, l.id), eq(schema.reserva.estado, "ABIERTA")));
    expect(Number(res.cantidad)).toBe(12);
    expect((await listarAuditoria({ entidad: "pedido", entidadId: p.id }))[0]).toMatchObject({ valorAnterior: "Gris oscuro y amarillo", valorNuevo: "008B-PR-RO" });
    expect((await iniciarDespacho(s.usuarios.DESPACHO, p.id)).id).toBeDefined();
  });
});
