/**
 * Revisión funcional previa a la entrega (06/10/2026): inyectora por tipo de
 * producto, flujo partida → ciclo → retiro de MP, situación real de los
 * pedidos y menú por áreas (mismas rutas y permisos).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

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
import { cerrarCiclo, crearCiclo, resumenParaCiclo, type NuevoCicloInput } from "@/lib/data/produccion";
import { retirarMateriaPrima } from "@/lib/data/materia-prima";
import { coberturaPorLinea, crearPedido, materialComprometido, situacionPedidos } from "@/lib/data/pedidos";
import { resolverInyectora } from "@/lib/inyectoras";
import { NAV_POR_ROL, ROLES_CON_AVISOS, rutaPermitida } from "@/lib/nav";
import {
  ROLES_GESTION,
  puedeCargarProduccion,
  puedeVerMateriaPrima,
  puedeVerPanelAdmin,
  puedeVerReclamos,
  puedeVerTrazabilidad,
} from "@/lib/auth/permisos";

let s: Semilla;
const db = () => holder.db!;

function ciclo(over: Partial<NuevoCicloInput>): NuevoCicloInput {
  return {
    fecha: "2026-10-06",
    inyectora: "",
    productoId: s.productos.rejNegro.id,
    operarioId: null,
    golpesInicio: 100,
    piezasPorGolpe: 1,
    cicloSegundos: null,
    modo: null,
    partidaId: null,
    pedidos: [],
    usuarioId: s.usuarios.ENCARGADO.id,
    ...over,
  };
}

beforeAll(async () => {
  await abrirBase();
  s = await sembrar(db());
});

afterAll(async () => {
  await cerrarBase();
});

describe("Inyectora según el tipo de producto (validado en el servidor)", () => {
  it("regla pura", () => {
    expect(resolverInyectora(false, "")).toEqual({ inyectora: "8" });
    expect(resolverInyectora(false, "Inyectora 8")).toEqual({ inyectora: "8" });
    expect(resolverInyectora(false, "6")).toHaveProperty("error");
    expect(resolverInyectora(true, "")).toHaveProperty("error");
    expect(resolverInyectora(true, "6")).toEqual({ inyectora: "6" });
    expect(resolverInyectora(true, "9")).toHaveProperty("error");
  });

  it("una baldosa no se puede cargar en otra inyectora; sin indicarla queda en la 8", async () => {
    expect(await crearCiclo(ciclo({ inyectora: "6" }))).toMatchObject({ error: /sólo en la inyectora 8/ });
    const c = await crearCiclo(ciclo({ inyectora: "" }));
    if ("error" in c) throw new Error(c.error);
    const [fila] = await db().select().from(schema.cicloProduccion).where(eq(schema.cicloProduccion.id, c.id));
    expect(fila.inyectora).toBe("8");
  });

  it("un accesorio exige una inyectora existente", async () => {
    expect(await crearCiclo(ciclo({ productoId: s.productos.esqNegro.id, inyectora: "" }))).toMatchObject({ error: /Elegí la inyectora/ });
    expect(await crearCiclo(ciclo({ productoId: s.productos.esqNegro.id, inyectora: "12" }))).toMatchObject({ error: /no existe/ });
    const c = await crearCiclo(ciclo({ productoId: s.productos.esqNegro.id, inyectora: "6" }));
    expect(c).toHaveProperty("id");
  });
});

describe("Partida y ciclo: continuidad entre días y retiro de MP al ciclo", () => {
  it("el resumen propone continuar la partida abierta y muestra el número que tendría una nueva", async () => {
    const r = (await resumenParaCiclo(s.productos.rejNegro.id))!;
    expect(r.esAccesorio).toBe(false);
    expect(r.colorNombre).toBe("Negro");
    expect(r.partidas).toHaveLength(1);
    expect(r.partidas[0].ultimoCicloAbierto).toBe(true);
    const [{ max }] = await db().select({ max: schema.partida.numero }).from(schema.partida).orderBy(schema.partida.numero);
    expect(r.siguientePartida).toBeGreaterThan(max);
  });

  it("no se continúa una partida con el ciclo del día anterior sin cerrar; cerrado, sigue con sus golpes", async () => {
    const r = (await resumenParaCiclo(s.productos.rejNegro.id))!;
    const partidaId = r.partidas[0].id;
    expect(await crearCiclo(ciclo({ partidaId, golpesInicio: 130 }))).toMatchObject({ error: /sin cerrar/ });

    const [abierto] = await db().select().from(schema.cicloProduccion).where(eq(schema.cicloProduccion.partidaId, partidaId));
    // El retiro de MP se hace sobre el ciclo ya iniciado y toma su inyectora.
    const retiro = await retirarMateriaPrima(s.usuarios.ENCARGADO, {
      materiaPrimaId: s.materiaPrima.copo2240.id,
      loteMpId: null,
      cantidadKg: 10,
      inyectora: "3",
      cicloId: abierto.id,
      entregaId: null,
      observaciones: null,
    });
    expect(retiro.error).toBeUndefined();
    const [rm] = await db().select().from(schema.retiroMp).where(eq(schema.retiroMp.id, retiro.id!));
    expect(rm.inyectora).toBe("8");

    expect((await cerrarCiclo(abierto.id, { golpesFin: 130, piezasDescartadas: 0, piezasEntregadas: 30, coladaKg: null, rebarbaKg: null, scrapKg: null, cambioCicloCausa: null, observaciones: null, cerrarPartida: false, usuarioId: s.usuarios.ENCARGADO.id })).error).toBeUndefined();
    const r2 = (await resumenParaCiclo(s.productos.rejNegro.id))!;
    expect(r2.partidas[0]).toMatchObject({ id: partidaId, ultimoGolpesFin: 130, ultimoCicloAbierto: false });
    const dia2 = await crearCiclo(ciclo({ partidaId, golpesInicio: 130, fecha: "2026-10-07" }));
    expect(dia2).toHaveProperty("id");
  });

  it("un retiro sin ciclo sólo acepta inyectoras existentes", async () => {
    const r = await retirarMateriaPrima(s.usuarios.ENCARGADO, {
      materiaPrimaId: s.materiaPrima.copo2240.id,
      loteMpId: null,
      cantidadKg: 1,
      inyectora: "15",
      cicloId: null,
      entregaId: null,
      observaciones: null,
    });
    expect(r.error).toMatch(/no existe/);
  });
});

describe("Situación real del pedido", () => {
  it("indica lo que falta producir y los renglones sin producto; con stock, está disponible para armar", async () => {
    const base = {
      clienteId: s.cliente.id,
      fechaPedido: "2026-10-06",
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
    };
    const conStock = await crearPedido({ ...base, lineas: [{ productoId: s.productos.rejBlanco.id, colorTexto: null, unidadesPedidas: 100 }] });
    const sinStock = await crearPedido({ ...base, lineas: [{ productoId: s.productos.rejBlanco.id, colorTexto: null, unidadesPedidas: 500 }] });
    if (!("id" in conStock) || !("id" in sinStock)) throw new Error("pedido");
    const [historico] = await db().insert(schema.pedido).values({ clienteId: s.cliente.id, fechaPedido: "2026-08-01", estado: "LISTO_PARA_DESPACHAR" }).returning();
    await db().insert(schema.pedidoLinea).values({ pedidoId: historico.id, productoId: null, colorTexto: "GRIS OSCURO Y VIOLETA", unidadesPedidas: 1 });

    const sit = await situacionPedidos([conStock.id, sinStock.id, historico.id]);
    // 520 en stock: el primero (100) entra; el segundo (500) compite con los 100 reservados del primero.
    expect(sit.get(conStock.id)).toMatchObject({ pendiente: 100, faltaProducir: 0, sinProducto: 0 });
    expect(sit.get(sinStock.id)).toMatchObject({ pendiente: 500, faltaProducir: 80 });
    expect(sit.get(historico.id)).toMatchObject({ sinProducto: 1, despachoEnCurso: false });

    // Coherencia entre pantallas: lo que falta en los pedidos suma lo mismo que el faltante global.
    const cobertura = await coberturaPorLinea();
    const lineas = await db().select().from(schema.pedidoLinea);
    for (const c of await materialComprometido()) {
      const suma = lineas
        .filter((l) => l.productoId === c.productoId)
        .reduce((t, l) => t + (cobertura.get(l.id)?.faltaProducir ?? 0), 0);
      expect(suma, c.codigo).toBe(c.faltaProducir);
    }
  });
});

describe("Menú por áreas: mismas rutas y permisos que antes", () => {
  it("cada rol ve exactamente las secciones que su permiso habilita, agrupadas Ventas → Fábrica → Administración", () => {
    for (const [rol, items] of Object.entries(NAV_POR_ROL) as [keyof typeof NAV_POR_ROL, (typeof NAV_POR_ROL)[keyof typeof NAV_POR_ROL]][]) {
      const esperadas = new Set(
        [
          "/tablero",
          "/pedidos",
          ROLES_CON_AVISOS.includes(rol) && "/avisos",
          ROLES_GESTION.includes(rol) && "/catalogo",
          ROLES_GESTION.includes(rol) && "/clientes",
          puedeVerReclamos(rol) && "/reclamos",
          puedeCargarProduccion(rol) && "/produccion",
          puedeVerMateriaPrima(rol) && "/materia-prima",
          puedeVerTrazabilidad(rol) && "/trazabilidad",
          puedeVerPanelAdmin(rol) && "/admin",
        ].filter(Boolean) as string[],
      );
      expect(new Set(items.map((i) => i.href)), rol).toEqual(esperadas);
      const orden = items.map((i) => i.seccion).filter(Boolean);
      const rango = { Ventas: 0, Fábrica: 1, Administración: 2 } as const;
      expect([...orden].sort((a, b) => rango[a!] - rango[b!]), rol).toEqual(orden);
    }
    expect(rutaPermitida("DESPACHO", "/admin/usuarios")).toBe(false);
    expect(rutaPermitida("GERENCIA", "/admin/usuarios")).toBe(true);
    expect(rutaPermitida("OPERARIO", "/pedidos/nuevo")).toBe(false);
  });
});
