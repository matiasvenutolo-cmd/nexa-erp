/**
 * Mejoras del 22/10/2026: usuarios y perfiles (Excel del cliente), turnos por
 * esquema, dosificación de master, lector de códigos, compras con necesidad,
 * matrices y molino.
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
import {
  puedeAdministrarUsuarios,
  puedeCrearPedido,
  puedeGestionarCompras,
  puedeOperarMolino,
  puedeOtorgarRol,
  puedeRecibirMolienda,
  puedeVerPrecios,
  puedeVerProduccion,
  puedeVerVentas,
} from "@/lib/auth/permisos";
import { NAV_POR_ROL, rutaPermitida } from "@/lib/nav";
import { cambiarSecretoAdmin, crearUsuarioAdmin, listarUsuariosAdmin, perfilesDe, usuariosConPin } from "@/lib/data/usuarios";
import { turnosPosibles, type Esquema } from "@/lib/turnos";
import { asignarOperario, guardarEsquema, opcionesTurno } from "@/lib/data/turnos";
import { enBolsas, masterParaBase } from "@/lib/presentaciones";
import { compararRecetasConDosificacion, crearDosificacion, resolverDosificacion } from "@/lib/data/dosificacion";
import { guardarReceta, listarPresentaciones } from "@/lib/data/recetas";
import { identificarCodigoRetiro, variantesCodigoMp } from "@/lib/data/maquina";
import { esLecturaRepetida, limpiarCodigo } from "@/components/lector-codigo";
import { actualizarCompra, calcularNecesidad, crearCompra, listarCompras } from "@/lib/data/compras";
import { ingresarMateriaPrima } from "@/lib/data/materia-prima";
import { actualizarIntervencion, listarIntervenciones, programarIntervencion } from "@/lib/data/matrices";
import { confirmarMolienda, descartesPendientes, entregarMolienda, recibirDescarte } from "@/lib/data/molino";
import { listarAuditoria } from "@/lib/data/auditoria";

let s: Semilla;
const db = () => holder.db!;
let master: { id: number };
let plastomer: { id: number };
let molienda: { id: number };
let sobranteAzul: { id: number };

async function saldoDeposito(mpId: number) {
  const [f] = await db().select().from(schema.saldo).where(and(eq(schema.saldo.materiaPrimaId, mpId), eq(schema.saldo.depositoId, s.deposito.id)));
  return Number(f?.cantidad ?? 0);
}

beforeAll(async () => {
  await abrirBase();
  s = await sembrar(db());
  [master, plastomer, molienda, sobranteAzul] = await db()
    .insert(schema.materiaPrima)
    .values([
      { codigoInterno: "24", nombre: "24-Master negro 951", tipo: "MASTER", minimo: "50" },
      { codigoInterno: "19", nombre: "19- PLASTOMER", tipo: "VIRGEN" },
      { codigoInterno: "401", nombre: "401- molienda p.rejillas", tipo: "MOLIENDA" },
      { codigoInterno: "407", nombre: "407- sobrante homopolimero esencia c M/ AZUL OSCURO", tipo: "SOBRANTE" },
    ])
    .returning();
}, 60000);

afterAll(async () => {
  await cerrarBase();
});

describe("Perfiles y permisos (Excel de usuarios)", () => {
  it("Gerencia de consulta ve todo con precios pero no escribe", () => {
    expect(puedeVerPrecios("GERENCIA_CONSULTA")).toBe(true);
    expect(puedeVerVentas("GERENCIA_CONSULTA")).toBe(true);
    expect(puedeVerProduccion("GERENCIA_CONSULTA")).toBe(true);
    expect(puedeCrearPedido("GERENCIA_CONSULTA")).toBe(false);
    expect(puedeGestionarCompras("GERENCIA_CONSULTA")).toBe(false);
    expect(rutaPermitida("GERENCIA_CONSULTA", "/pedidos/nuevo")).toBe(false);
    expect(rutaPermitida("GERENCIA_CONSULTA", "/compras")).toBe(true);
  });

  it("el Supervisor administra usuarios, sin precios, y no otorga perfiles de gerencia", () => {
    expect(puedeVerPrecios("SUPERVISOR", true)).toBe(false);
    expect(puedeAdministrarUsuarios("SUPERVISOR")).toBe(true);
    expect(puedeOtorgarRol("SUPERVISOR", "OPERARIO")).toBe(true);
    expect(puedeOtorgarRol("SUPERVISOR", "GERENCIA")).toBe(false);
    expect(puedeOtorgarRol("GERENCIA", "GERENCIA_CONSULTA")).toBe(true);
  });

  it("Administración no entra a producción; Compras, Matrices y Molino tienen su pantalla", () => {
    expect(puedeVerProduccion("ADMINISTRACION")).toBe(false);
    expect(NAV_POR_ROL.COMPRAS.map((i) => i.href)).toContain("/compras");
    expect(NAV_POR_ROL.MATRICES.map((i) => i.href)).toContain("/matrices");
    expect(NAV_POR_ROL.MOLINO.map((i) => i.href)).toContain("/molino");
    expect(rutaPermitida("MOLINO", "/pedidos")).toBe(false);
    expect(puedeOperarMolino("MOLINO") && puedeRecibirMolienda("MATERIA_PRIMA") && !puedeRecibirMolienda("MOLINO")).toBe(true);
  });

  it("una persona con varios perfiles: con contraseña los usa todos, con PIN sólo los de planta", () => {
    const dylan = { rol: "RETIROS_MP" as const, rolesAdicionales: ["OPERARIO", "ENCARGADO"] as ("OPERARIO" | "ENCARGADO")[] };
    expect(perfilesDe(dylan, "clave")).toEqual(["RETIROS_MP", "OPERARIO", "ENCARGADO"]);
    expect(perfilesDe(dylan, "pin")).toEqual(["OPERARIO", "RETIROS_MP"]);
    expect(perfilesDe({ rol: "SUPERVISOR", rolesAdicionales: [] }, "pin")).toEqual([]);
  });
});

describe("Alta de usuarios", () => {
  it("crea una cuenta pendiente de activación, sin credencial ni email inventado", async () => {
    const r = await crearUsuarioAdmin(s.usuarios.SUPERVISOR, { nombre: "Adriana Troncoso", rol: "DESPACHO" });
    expect(r.error).toBeUndefined();
    const fila = (await listarUsuariosAdmin()).find((u) => u.nombre === "Adriana Troncoso")!;
    expect(fila.accede).toBe("pendiente");
    expect(fila.email).toBeNull();
    expect((await usuariosConPin()).some((u) => u.nombre === "Adriana Troncoso")).toBe(false);
  });

  it("valida emails con espacios y no deja al Supervisor crear Gerencia", async () => {
    expect((await crearUsuarioAdmin(s.usuarios.SUPERVISOR, { nombre: "Nicolas", rol: "OPERARIO", email: "nicolas @nexa.com.ar" })).error).toMatch(/no es válido/);
    expect((await crearUsuarioAdmin(s.usuarios.SUPERVISOR, { nombre: "Braian", rol: "GERENCIA", email: "b@x.com" })).error).toMatch(/Gerencia/);
    expect((await crearUsuarioAdmin(s.usuarios.ADMINISTRACION, { nombre: "Otro", rol: "DESPACHO" })).error).toBeTruthy();
  });

  it("PIN sólo para perfiles de planta; contraseña necesita email; el alta con PIN aparece en el login", async () => {
    expect((await crearUsuarioAdmin(s.usuarios.SUPERVISOR, { nombre: "Ailen", rol: "ADMINISTRACION", email: "ailen@x.com", pin: "1234" })).error).toMatch(/planta/);
    expect((await crearUsuarioAdmin(s.usuarios.SUPERVISOR, { nombre: "Sin email", rol: "COMPRAS", password: "clave1234" })).error).toMatch(/email/);
    const r = await crearUsuarioAdmin(s.usuarios.SUPERVISOR, { nombre: "Ariel Orellano", rol: "OPERARIO", pin: "4821" });
    expect(r.error).toBeUndefined();
    expect((await usuariosConPin()).map((u) => u.nombre)).toContain("Ariel Orellano");
    const adriana = (await listarUsuariosAdmin()).find((u) => u.nombre === "Adriana Troncoso")!;
    expect((await cambiarSecretoAdmin(s.usuarios.SUPERVISOR, adriana.id, "9876", "PIN")).error).toBeUndefined();
    const historial = await listarAuditoria({ entidad: "usuario", entidadId: adriana.id });
    expect(historial.some((h) => h.campo === "PIN" && h.valorNuevo === "(cambiada)")).toBe(true);
  });
});

describe("Turnos por esquema", () => {
  const esq = (m: Record<string, Esquema>) => (f: string) => m[f] ?? null;
  const t = (iso: string) => new Date(`${iso}-03:00`);

  it("simple: un solo turno; fuera de horario no hay", () => {
    expect(turnosPosibles(t("2026-10-22T08:00:00"), esq({ "2026-10-22": "SIMPLE" })).map((x) => x.turno)).toEqual(["MANANA"]);
    expect(turnosPosibles(t("2026-10-22T17:00:00"), esq({ "2026-10-22": "SIMPLE" }))).toEqual([]);
  });

  it("doble: de 12 a 16 hay dos turnos (hay que preguntar)", () => {
    expect(turnosPosibles(t("2026-10-22T13:30:00"), esq({ "2026-10-22": "DOBLE" })).map((x) => x.turno)).toEqual(["MANANA", "TARDE"]);
    expect(turnosPosibles(t("2026-10-22T18:00:00"), esq({ "2026-10-22": "DOBLE" })).map((x) => x.turno)).toEqual(["TARDE"]);
  });

  it("triple: la noche termina a las 7 del día siguiente y pertenece al día anterior", () => {
    const m = esq({ "2026-10-22": "TRIPLE", "2026-10-23": "SIMPLE" });
    expect(turnosPosibles(t("2026-10-22T23:00:00"), m)).toEqual([{ turno: "NOCHE", fecha: "2026-10-22", esquema: "TRIPLE" }]);
    expect(turnosPosibles(t("2026-10-23T03:00:00"), m)).toEqual([{ turno: "NOCHE", fecha: "2026-10-22", esquema: "TRIPLE" }]);
    expect(turnosPosibles(t("2026-10-23T07:30:00"), m).map((x) => x.turno)).toEqual(["MANANA"]);
  });

  it("el Encargado carga el esquema y asigna; con superposición, la asignación define el turno", async () => {
    const [op] = await db().select().from(schema.usuario).where(eq(schema.usuario.nombre, "Ariel Orellano"));
    expect((await guardarEsquema(s.usuarios.OPERARIO, ["2026-10-22"], "DOBLE")).error).toBeTruthy();
    expect((await guardarEsquema(s.usuarios.ENCARGADO, ["2026-10-22"], "DOBLE")).error).toBeUndefined();
    expect((await asignarOperario(s.usuarios.ENCARGADO, { fecha: "2026-10-22", turno: "NOCHE", usuarioId: op.id })).error).toMatch(/no tiene ese turno/);
    expect((await asignarOperario(s.usuarios.ENCARGADO, { fecha: "2026-10-22", turno: "TARDE", usuarioId: s.usuarios.SUPERVISOR.id })).error).toMatch(/Operario/);
    expect((await asignarOperario(s.usuarios.ENCARGADO, { fecha: "2026-10-22", turno: "TARDE", usuarioId: op.id, inyectora: "8" })).error).toBeUndefined();
    const ahora = new Date("2026-10-22T14:00:00-03:00");
    const conAsignacion = await opcionesTurno(op.id, ahora);
    expect(conAsignacion.posibles).toHaveLength(2);
    expect(conAsignacion.sugerido?.turno).toBe("TARDE");
    expect(conAsignacion.preguntar).toBe(false);
    const sinAsignacion = await opcionesTurno(s.usuarios.OPERARIO.id, ahora);
    expect(sinAsignacion.preguntar).toBe(true);
    expect(sinAsignacion.opciones).toEqual(["MANANA", "TARDE"]);
  });
});

describe("Dosificación y cantidades físicas", () => {
  it("15 g por kg: 100 kg de 2240P llevan 1,5 kg de master = 2 bolsitas de 750 g", () => {
    expect(masterParaBase(100, 15)).toBe(1.5);
    expect(enBolsas(1.5, [{ nombre: "Bolsita 600 g", kg: 0.6 }, { nombre: "Bolsita 750 g", kg: 0.75 }])).toBe("2 bolsitas de 750 g");
  });

  it("ciego: 15 g cada 0,5 kg de mezcla (30 g/kg) con proporción pendiente; compara con las recetas", async () => {
    expect(
      (await crearDosificacion(s.usuarios.ENCARGADO, { familia: "CIEGO", colorId: null, materiaPrimaBaseId: s.materiaPrima.copo2630.id, materiaPrimaBase2Id: plastomer.id, gPorKgMp: 30, kgReferencia: 0.5, proporcionBase1: null })).error,
    ).toBeUndefined();
    expect((await crearDosificacion(s.usuarios.ENCARGADO, { familia: "REJILLA", colorId: null, materiaPrimaBaseId: s.materiaPrima.copo2240.id, gPorKgMp: 15 })).error).toBeUndefined();
    const d = await resolverDosificacion("CIEGO", s.colores.negro.id);
    expect(d).toMatchObject({ gPorKgMp: 30, kgReferencia: 0.5, proporcionBase1: null, materiaPrimaBase2Id: plastomer.id });
    expect((await crearDosificacion(s.usuarios.ENCARGADO, { familia: "CIEGO", colorId: s.colores.rojo.id, materiaPrimaBaseId: null, gPorKgMp: 30, proporcionBase1: 1.5, materiaPrimaBase2Id: plastomer.id })).error).toMatch(/proporción/);

    const pres = await listarPresentaciones();
    const bolsa = pres.find((p) => p.nombre === "Bolsa 25 kg")!;
    const b600 = pres.find((p) => p.nombre === "Bolsita 600 g")!;
    await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejNegro.id, "REGIMEN", {
      items: [
        { materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa.id, cantidad: 4 },
        { materiaPrimaId: master.id, presentacionId: b600.id, cantidad: 2 },
      ],
    });
    const fila = (await compararRecetasConDosificacion()).find((x) => x.productoId === s.productos.rejNegro.id)!;
    expect(fila).toMatchObject({ kgBase: 100, kgMasterReceta: 1.2, kgMasterDosificacion: 1.5, sugerenciaMaster: "2 bolsitas de 750 g" });
  });

  it("sobrante y molienda se habilitan por separado y no se mezcla un sobrante de otro color", async () => {
    const pres = await listarPresentaciones();
    const bolsa = pres.find((p) => p.nombre === "Bolsa 25 kg")!;
    await db().insert(schema.presentacionMp).values({ tipoMp: "SOBRANTE", nombre: "Bolsa sobrante 10 kg", kg: "10" });
    await db().insert(schema.presentacionMp).values({ tipoMp: "MOLIENDA", nombre: "Bolsa molienda 20 kg", kg: "20" });
    const pres2 = await listarPresentaciones();
    const bSob = pres2.find((p) => p.nombre === "Bolsa sobrante 10 kg")!;
    const bMol = pres2.find((p) => p.nombre === "Bolsa molienda 20 kg")!;
    await db().update(schema.producto).set({ aceptaSobrante: true }).where(eq(schema.producto.id, s.productos.rejNegro.id));
    const items = (extra: { materiaPrimaId: number; presentacionId: number; cantidad: number }) => ({ items: [{ materiaPrimaId: s.materiaPrima.copo2240.id, presentacionId: bolsa.id, cantidad: 3 }, extra] });
    expect((await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejNegro.id, "ARRANQUE", items({ materiaPrimaId: molienda.id, presentacionId: bMol.id, cantidad: 1 }))).error).toMatch(/molienda/);
    expect((await guardarReceta(s.usuarios.ENCARGADO, s.productos.rejNegro.id, "ARRANQUE", items({ materiaPrimaId: sobranteAzul.id, presentacionId: bSob.id, cantidad: 1 }))).error).toMatch(/Azul Oscuro/);
  });
});

describe("Lector de códigos", () => {
  it("acepta letras, números y guiones, e ignora la misma lectura en menos de 1 segundo", () => {
    expect(limpiarCodigo(" b24 ")).toEqual({ codigo: "B24" });
    expect(limpiarCodigo("001B-PR-NE")).toEqual({ codigo: "001B-PR-NE" });
    expect("error" in limpiarCodigo("31'2")).toBe(true);
    expect(esLecturaRepetida({ codigo: "B24", en: 1000 }, "B24", 1800)).toBe(true);
    expect(esLecturaRepetida({ codigo: "B24", en: 1000 }, "B24", 2100)).toBe(false);
    expect(esLecturaRepetida({ codigo: "B24", en: 1000 }, "031", 1200)).toBe(false);
  });

  it("identifica el material por el código estandarizado y rechaza productos terminados", async () => {
    expect(variantesCodigoMp("031")).toContain("31");
    expect(variantesCodigoMp("B24")).toContain("24");
    const r = await identificarCodigoRetiro("031");
    expect(r.lectura).toMatchObject({ tipo: "material", materiaPrima: { id: s.materiaPrima.copo2240.id } });
    expect((await identificarCodigoRetiro("b24")).lectura).toMatchObject({ tipo: "material", materiaPrima: { id: master.id } });
    expect((await identificarCodigoRetiro("001B-PR-NE")).error).toMatch(/producto terminado/);
    expect((await identificarCodigoRetiro("00012345678")).error).toBeTruthy();
    expect((await identificarCodigoRetiro("12345678901234567890123")).error).toMatch(/27 dígitos/);
  });
});

describe("Compras", () => {
  let compraId: number;
  it("registra la compra y el ingreso imputado la entrega sin contar dos veces el stock", async () => {
    expect((await crearCompra(s.usuarios.MATERIA_PRIMA, { materiaPrimaId: master.id, cantidadKg: 50, fechaPedido: "2026-10-20" })).error).toMatch(/permiso/);
    expect((await crearCompra(s.usuarios.COMPRAS, { materiaPrimaId: molienda.id, cantidadKg: 50, fechaPedido: "2026-10-20" })).error).toMatch(/no se compra/);
    const r = await crearCompra(s.usuarios.COMPRAS, { materiaPrimaId: master.id, cantidadKg: 50, fechaPedido: "2026-10-20", fechaEntregaEstimada: "2026-10-21", proveedor: "Berma" });
    compraId = r.id!;
    expect((await actualizarCompra(s.usuarios.COMPRAS, compraId, { estado: "ENTREGADA" })).error).toMatch(/ingreso/);
    const antes = await saldoDeposito(master.id);
    const ing = await ingresarMateriaPrima(s.usuarios.MATERIA_PRIMA, {
      materiaPrimaId: master.id,
      proveedor: "Berma",
      fechaRecepcion: "2026-10-22",
      cantidadKg: 20,
      codigoBarra: "000002400000001000000000001",
      conCertificado: false,
      compraId,
    });
    expect(ing.error).toBeUndefined();
    expect(await saldoDeposito(master.id)).toBe(antes + 20);
    const c = (await listarCompras()).find((x) => x.id === compraId)!;
    expect(c).toMatchObject({ estado: "PARCIAL", recibidoKg: 20, pendienteKg: 30 });
  });

  it("la necesidad cruza recetas, stock y compras; avisa riesgo y lo no configurado", async () => {
    await actualizarCompra(s.usuarios.COMPRAS, compraId, { estado: "FALTANTE", motivo: "Berma sin stock" });
    const n = await calcularNecesidad();
    const fm = n.filas.find((f) => f.materiaPrimaId === master.id)!;
    expect(fm.compradoPendienteKg).toBe(30);
    expect(fm.objetivoMpKg).toBe(50);
    expect(fm.riesgo).toMatch(/tono parecido/);
    // El negro de rejilla está bajo su mínimo (1.500) y tiene receta: aporta material.
    expect(fm.stockProductoKg).toBeGreaterThan(0);
    expect(fm.estimado).toBe(true);
    expect(fm.proyectadaKg).toBeCloseTo(Math.max(0, fm.pedidosKg + fm.stockProductoKg + fm.objetivoMpKg - fm.disponibleKg - 30), 3);
    // Sin receta: se informa aparte, no se inventa.
    expect(n.sinConfigurar.some((x) => x.codigo === "004A-PR-BL" || x.codigo === "008B-PR-RO")).toBe(true);
    const hist = await listarAuditoria({ entidad: "compra_mp", entidadId: compraId });
    expect(hist.some((h) => h.campo === "estado" && h.motivo === "Berma sin stock")).toBe(true);
  });
});

describe("Matrices", () => {
  it("programa un cambio de matriz, avanza su estado y queda en el historial", async () => {
    expect((await programarIntervencion(s.usuarios.MOLINO, { tipo: "CAMBIO_MATRIZ", matriz: "Ciego moneda", fechaProgramada: "2026-10-23", inyectora: "8" })).error).toMatch(/permiso/);
    expect((await programarIntervencion(s.usuarios.MATRICES, { tipo: "CAMBIO_MATRIZ", matriz: "Ciego moneda", fechaProgramada: "2026-10-23" })).error).toMatch(/máquina/);
    const r = await programarIntervencion(s.usuarios.MATRICES, { tipo: "CAMBIO_MATRIZ", matriz: "Ciego moneda", matrizAnterior: "Rejilla", fechaProgramada: "2026-10-23", inyectora: "8", turno: "MANANA", responsableId: s.usuarios.MATRICES.id });
    expect(r.error).toBeUndefined();
    expect((await actualizarIntervencion(s.usuarios.MATRICES, r.id!, { estado: "CANCELADA" })).error).toMatch(/motivo/);
    expect((await actualizarIntervencion(s.usuarios.MATRICES, r.id!, { estado: "EN_CURSO" })).error).toBeUndefined();
    expect((await actualizarIntervencion(s.usuarios.MATRICES, r.id!, { estado: "REALIZADA", observaciones: "OK" })).error).toBeUndefined();
    expect((await actualizarIntervencion(s.usuarios.MATRICES, r.id!, { estado: "EN_CURSO" })).error).toMatch(/cerrado/);
    const [i] = await listarIntervenciones({ estados: ["REALIZADA"] });
    expect(i.iniciadaEn).not.toBeNull();
    expect(i.realizadaEn).not.toBeNull();
  });
});

describe("Molino", () => {
  it("descarte → molienda entregada → MP confirma: entra al stock una sola vez", async () => {
    const d = await recibirDescarte(s.usuarios.MOLINO, { origen: "Inyectora 8 · colada", material: "Rejilla negro", kg: 30 });
    expect(d.error).toBeUndefined();
    expect((await entregarMolienda(s.usuarios.MOLINO, { bolson: "n4", materiaPrimaId: sobranteAzul.id, kg: 28 })).error).toMatch(/molienda/);
    const e = await entregarMolienda(s.usuarios.MOLINO, { bolson: "n4", materiaPrimaId: molienda.id, kg: 28, descarteIds: [d.id!] });
    expect(e.error).toBeUndefined();
    expect(await descartesPendientes()).toHaveLength(0);
    expect(await saldoDeposito(molienda.id)).toBe(0);
    expect((await confirmarMolienda(s.usuarios.MOLINO, e.id!, { aceptar: true })).error).toMatch(/Materia Prima/);
    const c = await confirmarMolienda(s.usuarios.MATERIA_PRIMA, e.id!, { aceptar: true, kgRecibidos: 27.5 });
    expect(c.error).toBeUndefined();
    expect(c.codigo).toMatch(/^000040199999999/);
    expect(await saldoDeposito(molienda.id)).toBe(27.5);
    expect((await confirmarMolienda(s.usuarios.MATERIA_PRIMA, e.id!, { aceptar: true })).error).toMatch(/ya fue/);
    expect(await saldoDeposito(molienda.id)).toBe(27.5);
  });

  it("una entrega rechazada no entra al stock", async () => {
    const e = await entregarMolienda(s.usuarios.MOLINO, { bolson: "n5", materiaPrimaId: molienda.id, kg: 10 });
    expect((await confirmarMolienda(s.usuarios.MATERIA_PRIMA, e.id!, { aceptar: false })).error).toMatch(/motivo/);
    expect((await confirmarMolienda(s.usuarios.MATERIA_PRIMA, e.id!, { aceptar: false, motivo: "húmeda" })).error).toBeUndefined();
    expect(await saldoDeposito(molienda.id)).toBe(27.5);
  });
});
