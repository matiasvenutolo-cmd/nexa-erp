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

import { abrirBase, cerrarBase, sembrar, holder, type Semilla } from "./helpers/db";
import * as schema from "@/lib/db/schema";
import { semaforoStock } from "@/lib/data/stock";
import { listarProductos, crearProductoNuevo, unidadesPorCaja, desglosarCajas } from "@/lib/data/catalogo";
import { actualizarMinMaxProducto, actualizarMinMaxMateriaPrima, listarMinMaxProductos } from "@/lib/data/stock-config";
import { actualizarParametro, obtenerParametros } from "@/lib/data/parametros";
import {
  actualizarDosificacion,
  crearDosificacion,
  eliminarExcepcionDosificacion,
  resolverDosificacion,
} from "@/lib/data/dosificacion";
import { actualizarFichaColor, crearColorEspecial, listarColores } from "@/lib/data/colores";
import { listarAuditoria } from "@/lib/data/auditoria";
import { cambiarUrgencia, crearPedido, marcarEntregado, obtenerPedido } from "@/lib/data/pedidos";
import { colaProduccion } from "@/lib/data/produccion";
import { resolverClienteDelPedido } from "@/lib/data/clientes";
import { actualizarUsuarioAdmin, crearUsuarioAdmin } from "@/lib/data/usuarios";
import { claveColor, pareceMulticolor } from "@/lib/catalogo-normalizacion";

let s: Semilla;
const db = () => holder.db!;

beforeAll(async () => {
  await abrirBase();
  s = await sembrar(db());
});

afterAll(async () => {
  await cerrarBase();
});

async function producto(id: number) {
  const [p] = await db().select().from(schema.producto).where(eq(schema.producto.id, id));
  return p;
}

async function estadoDe(productoId: number) {
  return (await listarProductos()).find((p) => p.id === productoId)!.estado;
}

describe("1-2. Mínimos y máximos de stock", () => {
  it("el Encargado modifica el mínimo y queda persistido y auditado", async () => {
    const r = await actualizarMinMaxProducto(s.usuarios.ENCARGADO, s.productos.rejBlanco.id, {
      minimo: 600,
      maximo: null,
      motivo: "Ajuste por ventas",
    });
    expect(r.error).toBeUndefined();
    expect((await producto(s.productos.rejBlanco.id)).minimo).toBe(600);

    const historial = await listarAuditoria({ entidad: "producto", entidadId: s.productos.rejBlanco.id });
    expect(historial).toHaveLength(1);
    expect(historial[0]).toMatchObject({ campo: "minimo", valorAnterior: "500", valorNuevo: "600", motivo: "Ajuste por ventas" });
    expect(historial[0].usuarioNombre).toBe("Usuario ENCARGADO");
  });

  it("modifica el máximo", async () => {
    const r = await actualizarMinMaxProducto(s.usuarios.ENCARGADO, s.productos.rejBlanco.id, { minimo: 600, maximo: 700 });
    expect(r.error).toBeUndefined();
    expect((await producto(s.productos.rejBlanco.id)).maximo).toBe(700);
    const historial = await listarAuditoria({ entidad: "producto", entidadId: s.productos.rejBlanco.id });
    // Sólo se registró el campo que cambió (el mínimo quedó igual).
    expect(historial[0]).toMatchObject({ campo: "maximo", valorAnterior: null, valorNuevo: "700" });
    expect(historial).toHaveLength(2);
  });

  it("rechaza un máximo menor que el mínimo y valores negativos", async () => {
    expect((await actualizarMinMaxProducto(s.usuarios.ENCARGADO, s.productos.rejBlanco.id, { minimo: 600, maximo: 300 })).error).toMatch(/máximo/);
    expect((await actualizarMinMaxProducto(s.usuarios.ENCARGADO, s.productos.rejBlanco.id, { minimo: -1, maximo: null })).error).toBeDefined();
    expect((await producto(s.productos.rejBlanco.id)).maximo).toBe(700);
  });

  it("también para materia prima, con decimales", async () => {
    const r = await actualizarMinMaxMateriaPrima(s.usuarios.GERENCIA, s.materiaPrima.copo2240.id, { minimo: 3500.5, maximo: 6000 });
    expect(r.error).toBeUndefined();
    const [mp] = await db().select().from(schema.materiaPrima).where(eq(schema.materiaPrima.id, s.materiaPrima.copo2240.id));
    expect(Number(mp.minimo)).toBe(3500.5);
  });
});

describe("3. Semáforo", () => {
  it("se recalcula solo al cambiar el mínimo (caso Carrefour)", async () => {
    // Rojo: stock 168, mínimo 500 → crítico
    expect(await estadoDe(s.productos.rejRojo.id)).toBe("critico");
    await actualizarMinMaxProducto(s.usuarios.ENCARGADO, s.productos.rejRojo.id, { minimo: 150, maximo: 1000 });
    // 168 <= 150 * 1,15 = 172,5 → bajo
    expect(await estadoDe(s.productos.rejRojo.id)).toBe("bajo");
    await actualizarMinMaxProducto(s.usuarios.ENCARGADO, s.productos.rejRojo.id, { minimo: 100, maximo: 1000 });
    expect(await estadoDe(s.productos.rejRojo.id)).toBe("ok");
    await actualizarMinMaxProducto(s.usuarios.ENCARGADO, s.productos.rejRojo.id, { minimo: 100, maximo: 160 });
    expect(await estadoDe(s.productos.rejRojo.id)).toBe("exceso");
  });

  it("el margen de 'Bajo' sale del parámetro, no del código", async () => {
    await actualizarMinMaxProducto(s.usuarios.ENCARGADO, s.productos.rejRojo.id, { minimo: 150, maximo: null });
    expect(await estadoDe(s.productos.rejRojo.id)).toBe("bajo");
    const r = await actualizarParametro(s.usuarios.ENCARGADO, "semaforo_margen_bajo", 0.1);
    expect(r.error).toBeUndefined();
    // 168 > 150 * 1,10 = 165 → ok
    expect(await estadoDe(s.productos.rejRojo.id)).toBe("ok");
    await actualizarParametro(s.usuarios.ENCARGADO, "semaforo_margen_bajo", 0.15);
  });

  it("no se rompe con datos incompletos", () => {
    expect(semaforoStock(0, null, null, 0.15)).toBe("sin-datos"); // producto nuevo
    expect(semaforoStock(0, 0, 0, 0.15)).toBe("sin-datos"); // 0/0 = no controlado
    expect(semaforoStock(0, 0, 500, 0.15)).toBe("ok"); // mínimo 0
    expect(semaforoStock(600, 0, 500, 0.15)).toBe("exceso");
    expect(semaforoStock(10, 500, 0, 0.15)).toBe("critico"); // máximo 0 = sin máximo
    expect(semaforoStock(0, 500, null, 0.15)).toBe("critico"); // stock 0
    expect(semaforoStock(null, 500, 700, 0.15)).toBe("critico");
    expect(semaforoStock("520.000", "500", null, 0.15)).toBe("bajo"); // numeric de Postgres
  });
});

describe("4-5. Dosificación de master", () => {
  it("valor base por familia y excepción por color", async () => {
    expect(await resolverDosificacion("REJILLA", s.colores.blanco.id)).toBeNull();

    await crearDosificacion(s.usuarios.ENCARGADO, { familia: "REJILLA", colorId: null, materiaPrimaBaseId: s.materiaPrima.copo2240.id, kgPorKgMp: 0.015 });
    await crearDosificacion(s.usuarios.ENCARGADO, { familia: "REJILLA", colorId: s.colores.negro.id, materiaPrimaBaseId: s.materiaPrima.copo2240.id, kgPorKgMp: 0.012 });
    await crearDosificacion(s.usuarios.SUPERVISOR, { familia: "CIEGO", colorId: null, materiaPrimaBaseId: s.materiaPrima.copo2630.id, kgPorKgMp: 0.018 });

    expect(await resolverDosificacion("REJILLA", s.colores.blanco.id)).toMatchObject({ kgPorKgMp: 0.015, origen: "base" });
    expect(await resolverDosificacion("REJILLA", s.colores.negro.id)).toMatchObject({ kgPorKgMp: 0.012, origen: "excepcion", colorNombre: "Negro" });
    // La excepción del negro es de rejilla: el ciego negro usa la base de ciego.
    expect(await resolverDosificacion("CIEGO", s.colores.negro.id)).toMatchObject({ kgPorKgMp: 0.018, origen: "base" });
  });

  it("no admite dos valores para la misma familia y color", async () => {
    const r = await crearDosificacion(s.usuarios.ENCARGADO, { familia: "REJILLA", colorId: s.colores.negro.id, materiaPrimaBaseId: null, kgPorKgMp: 0.02 });
    expect(r.error).toMatch(/Ya existe/);
  });

  it("modificar la dosificación de un color cambia lo que resuelve el sistema y queda auditado", async () => {
    await crearDosificacion(s.usuarios.ENCARGADO, { familia: "REJILLA", colorId: s.colores.rojo.id, materiaPrimaBaseId: null, kgPorKgMp: 0.014 });
    const [fila] = await db()
      .select()
      .from(schema.dosificacionMaster)
      .where(and(eq(schema.dosificacionMaster.familia, "REJILLA"), eq(schema.dosificacionMaster.colorId, s.colores.rojo.id)));
    const r = await actualizarDosificacion(s.usuarios.ENCARGADO, fila.id, { kgPorKgMp: 0.016, materiaPrimaBaseId: null, motivo: "Prueba de color" });
    expect(r.error).toBeUndefined();
    expect(await resolverDosificacion("REJILLA", s.colores.rojo.id)).toMatchObject({ kgPorKgMp: 0.016 });
    const historial = await listarAuditoria({ entidad: "dosificacion_master", entidadId: fila.id });
    expect(historial[0]).toMatchObject({ campo: "kg_por_kg_mp", valorNuevo: "0.016" });

    // Quitar la excepción: vuelve a la base.
    await eliminarExcepcionDosificacion(s.usuarios.ENCARGADO, fila.id);
    expect(await resolverDosificacion("REJILLA", s.colores.rojo.id)).toMatchObject({ kgPorKgMp: 0.015, origen: "base" });
  });

  it("rechaza valores imposibles y la base no se puede borrar", async () => {
    expect((await crearDosificacion(s.usuarios.ENCARGADO, { familia: "CIEGO", colorId: s.colores.rojo.id, materiaPrimaBaseId: null, kgPorKgMp: 1.5 })).error).toBeDefined();
    const [base] = await db().select().from(schema.dosificacionMaster).where(eq(schema.dosificacionMaster.familia, "CIEGO"));
    expect((await eliminarExcepcionDosificacion(s.usuarios.ENCARGADO, base.id)).error).toMatch(/base/);
  });
});

describe("6-7. Colores especiales", () => {
  it("normaliza mayúsculas, acentos y espacios igual que Postgres", async () => {
    expect(claveColor("  AZUL   Oscuro ")).toBe("azul oscuro");
    const [c] = await db().select({ clave: schema.color.clave }).from(schema.color).where(eq(schema.color.id, s.colores.azul.id));
    expect(c.clave).toBe(claveColor("Azul Oscuro"));
    // La base no admite otro color que normalice igual.
    await expect(db().insert(schema.color).values({ nombre: "AZUL OSCURO", iniciales: "ZZ" })).rejects.toThrow();
  });

  it("un color especial pedido por un cliente queda registrado con solicitante, proveedor y master", async () => {
    const r = await crearProductoNuevo(s.usuarios.ADMINISTRACION, {
      familia: "REJILLA",
      tipo: "UNICO",
      colorNombre: "Azul Carrefour",
      proveedorMasterId: s.proveedores.arcolor.id,
      clienteId: s.cliente.id,
      masterNombre: "Master Azul Carrefour",
      masterCodigo: "AR-3399",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.colorNuevo).toBe(true);

    const colores = await listarColores({ soloEspeciales: true });
    const azul = colores.find((c) => c.nombre === "Azul Carrefour")!;
    expect(azul).toMatchObject({
      especial: true,
      oficial: false,
      clienteNombre: "Carrefour",
      proveedorNombre: "Arcolor",
      masterNombre: "Master Azul Carrefour",
      masterCodigo: "AR-3399",
      productos: 1,
    });
    // El producto copia sus datos físicos de un producto de la misma familia y tipo.
    const p = await producto(r.id);
    expect(p).toMatchObject({ kgPorUnidad: "0.6100", piezasPorGolpe: 1, unidadesPorCaja: null, esAccesorio: false });
    expect((await listarAuditoria({ entidad: "color", entidadId: azul.id }))[0].usuarioNombre).toBe("Usuario ADMINISTRACION");
  });

  it("se reutiliza años después aunque lo escriban distinto, sin duplicar color ni producto", async () => {
    const antes = (await db().select().from(schema.color)).length;
    const r = await crearProductoNuevo(s.usuarios.ADMINISTRACION, {
      familia: "REJILLA",
      tipo: "UNICO",
      colorNombre: "  AZUL carrefour ",
      proveedorMasterId: s.proveedores.arcolor.id,
    });
    expect(r.ok && !r.colorNuevo).toBe(true);
    expect((await db().select().from(schema.color)).length).toBe(antes);

    // En otro tipo de producto reutiliza el color (con su master) y crea sólo el producto.
    const ciego = await crearProductoNuevo(s.usuarios.ADMINISTRACION, {
      familia: "CIEGO",
      tipo: "MONEDA",
      colorNombre: "azul carrefour",
      proveedorMasterId: s.proveedores.arcolor.id,
    });
    expect(ciego.ok && !ciego.colorNuevo).toBe(true);
    expect((await listarColores({ texto: "carrefour" }))[0].productos).toBe(2);
  });

  it("la búsqueda encuentra el color por solicitante o por código de master", async () => {
    expect((await listarColores({ texto: "carrefour" })).map((c) => c.nombre)).toContain("Azul Carrefour");
    expect((await listarColores({ texto: "AR-3399" })).map((c) => c.nombre)).toEqual(["Azul Carrefour"]);
  });

  it("alta directa desde el Panel Admin y edición auditada de su ficha", async () => {
    const r = await crearColorEspecial(s.usuarios.ENCARGADO, { nombre: "Verde Stand", clienteId: null, proveedorMasterId: s.proveedores.berma.id });
    expect(r.error).toBeUndefined();
    const dup = await crearColorEspecial(s.usuarios.ENCARGADO, { nombre: "VERDE stand", clienteId: null, proveedorMasterId: null });
    expect(dup).toMatchObject({ existente: true, id: r.id });

    await actualizarFichaColor(s.usuarios.ENCARGADO, r.id!, {
      especial: true,
      clienteId: s.cliente.id,
      proveedorMasterId: s.proveedores.berma.id,
      masterNombre: "B20-Master Verde",
      masterCodigo: "120001",
      masterMateriaPrimaId: null,
      observaciones: null,
      motivo: "Datos del proveedor",
    });
    const campos = (await listarAuditoria({ entidad: "color", entidadId: r.id! })).map((a) => a.campo);
    expect(campos).toEqual(expect.arrayContaining(["clienteId", "masterNombre", "masterCodigo"]));
  });

  it("un color de la lista oficial no entra por la vía de 'color especial'", async () => {
    const r = await crearProductoNuevo(s.usuarios.ADMINISTRACION, {
      familia: "REJILLA",
      tipo: "UNICO",
      colorNombre: "negro",
      proveedorMasterId: s.proveedores.berma.id,
    });
    // Mismo tipo, color y proveedor que 001B: reutiliza ese producto.
    expect(r.ok && r.id).toBe(s.productos.rejNegro.id);
    const otroProveedor = await crearProductoNuevo(s.usuarios.ADMINISTRACION, {
      familia: "REJILLA",
      tipo: "UNICO",
      colorNombre: "NEGRO",
      proveedorMasterId: s.proveedores.arcolor.id,
    });
    expect(otroProveedor.ok).toBe(false);
  });
});

describe("8. Pedido con varios colores", () => {
  it("detecta nombres que describen varios colores", () => {
    expect(pareceMulticolor("Negro, blanco y rojo", [])).toBe(true);
    expect(pareceMulticolor("Gris oscuro y amarillo", [])).toBe(true);
    expect(pareceMulticolor("negro/blanco", [])).toBe(true);
    expect(pareceMulticolor("Azul Carrefour", [])).toBe(false);
    expect(pareceMulticolor("Rojo Fuego", [])).toBe(false);
  });

  it("no se puede registrar 'Negro, blanco y rojo' como un color", async () => {
    const r = await crearProductoNuevo(s.usuarios.ADMINISTRACION, {
      familia: "REJILLA",
      tipo: "UNICO",
      colorNombre: "Negro, blanco y rojo",
      proveedorMasterId: s.proveedores.berma.id,
    });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? "" : r.error).toMatch(/renglón/);
  });

  it("100 negro + 100 blanco + 50 rojo son tres líneas con tres productos", async () => {
    const r = await crearPedido({
      clienteId: s.cliente.id,
      fechaPedido: "2026-10-01",
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
      lineas: [
        { productoId: s.productos.rejNegro.id, colorTexto: "Negro", unidadesPedidas: 100 },
        { productoId: s.productos.rejBlanco.id, colorTexto: "Blanco", unidadesPedidas: 100 },
        { productoId: s.productos.rejRojo.id, colorTexto: "Rojo", unidadesPedidas: 50 },
      ],
    });
    expect("id" in r).toBe(true);
    if (!("id" in r)) return;
    const pedido = (await obtenerPedido(r.id))!;
    expect(pedido.lineas.map((l) => l.productoId).sort()).toEqual(
      [s.productos.rejNegro.id, s.productos.rejBlanco.id, s.productos.rejRojo.id].sort(),
    );
    const reservas = await db().select().from(schema.reserva);
    expect(reservas.filter((x) => x.estado === "ABIERTA")).toHaveLength(3);
  });

  it("rechaza un renglón de texto libre sin producto", async () => {
    const r = await crearPedido({
      clienteId: s.cliente.id,
      fechaPedido: "2026-10-01",
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
      lineas: [{ productoId: null, colorTexto: "Negro, blanco y rojo", unidadesPedidas: 250 }],
    });
    expect("error" in r).toBe(true);
  });
});

describe("9-10. Permisos", () => {
  it("Encargado y Gerencia pueden cambiar mínimos; nadie más", async () => {
    for (const rol of ["ENCARGADO", "GERENCIA"] as const) {
      expect((await actualizarMinMaxProducto(s.usuarios[rol], s.productos.ciegoNegro.id, { minimo: 1500, maximo: 2000 })).error).toBeUndefined();
    }
    const antes = (await listarAuditoria({ entidad: "producto", entidadId: s.productos.ciegoNegro.id })).length;
    for (const rol of ["SUPERVISOR", "ADMINISTRACION", "OPERARIO", "DESPACHO", "MATERIA_PRIMA", "MOLINO"] as const) {
      const r = await actualizarMinMaxProducto(s.usuarios[rol], s.productos.ciegoNegro.id, { minimo: 1, maximo: 2 });
      expect(r.error, rol).toMatch(/permiso/);
    }
    expect((await producto(s.productos.ciegoNegro.id)).minimo).toBe(1500);
    expect((await listarAuditoria({ entidad: "producto", entidadId: s.productos.ciegoNegro.id })).length).toBe(antes);
  });

  it("un operario no toca master, parámetros, colores ni usuarios", async () => {
    const op = s.usuarios.OPERARIO;
    expect((await crearDosificacion(op, { familia: "CIEGO", colorId: s.colores.blanco.id, materiaPrimaBaseId: null, kgPorKgMp: 0.02 })).error).toMatch(/permiso/);
    expect((await actualizarParametro(op, "unidades_por_caja_pisos", 30)).error).toMatch(/permiso/);
    expect((await crearColorEspecial(op, { nombre: "Fucsia", clienteId: null, proveedorMasterId: null })).error).toMatch(/permiso/);
    expect((await crearUsuarioAdmin(op, { nombre: "X", email: "x@test", rol: "GERENCIA", secreto: "12345678" })).error).toMatch(/permiso/);
    const r = await crearProductoNuevo(op, { familia: "REJILLA", tipo: "UNICO", colorNombre: "Fucsia", proveedorMasterId: s.proveedores.berma.id });
    expect(r.ok).toBe(false);
    expect((await obtenerParametros()).unidades_por_caja_pisos).toBe(25);
  });

  it("administración de usuarios: sólo gerencia, y nadie se desactiva a sí mismo", async () => {
    expect((await crearUsuarioAdmin(s.usuarios.ENCARGADO, { nombre: "Y", email: "y@test", rol: "OPERARIO", secreto: "1234" })).error).toMatch(/permiso/);
    expect((await crearUsuarioAdmin(s.usuarios.GERENCIA, { nombre: "Operario Turno Noche", rol: "OPERARIO", secreto: "4321" })).error).toBeUndefined();
    const g = s.usuarios.GERENCIA;
    const r = await actualizarUsuarioAdmin(g, g.id, { nombre: "Usuario GERENCIA", email: "gerencia@test", rol: "GERENCIA", activo: false });
    expect(r.error).toMatch(/vos mismo/);
  });

  it("prioridad manual: sólo Encargado o Supervisor, con motivo", async () => {
    const [p] = await db().select().from(schema.pedido).limit(1);
    expect((await cambiarUrgencia(s.usuarios.ADMINISTRACION, p.id, true, "urgente")).error).toBeDefined();
    expect((await cambiarUrgencia(s.usuarios.ENCARGADO, p.id, true, "")).error).toMatch(/motivo/);
    expect((await cambiarUrgencia(s.usuarios.SUPERVISOR, p.id, true, "Stand de un cliente")).error).toBeUndefined();
  });
});

describe("Prioridad automática por fecha y excepción manual", () => {
  it("ordena la cola por fecha de entrega y respeta la urgencia", async () => {
    const base = {
      clienteId: s.cliente.id,
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
    // Ciego negro (stock 230): dos pedidos, el segundo entrega antes.
    const tarde = await crearPedido({ ...base, fechaPedido: "2026-10-01", fechaEntregaPactada: "2026-10-30", lineas: [{ productoId: s.productos.ciegoNegro.id, colorTexto: null, unidadesPedidas: 200 }] });
    const pronto = await crearPedido({ ...base, fechaPedido: "2026-10-03", fechaEntregaPactada: "2026-10-10", lineas: [{ productoId: s.productos.ciegoNegro.id, colorTexto: null, unidadesPedidas: 200 }] });
    if (!("id" in tarde) || !("id" in pronto)) throw new Error("pedido no creado");

    let fila = (await colaProduccion()).find((f) => f.productoId === s.productos.ciegoNegro.id)!;
    expect(fila.pedidos.map((p) => p.pedidoId)).toEqual([pronto.id, tarde.id]);

    await cambiarUrgencia(s.usuarios.ENCARGADO, tarde.id, true, "Cliente reprogramó la obra");
    fila = (await colaProduccion()).find((f) => f.productoId === s.productos.ciegoNegro.id)!;
    expect(fila.pedidos[0]).toMatchObject({ pedidoId: tarde.id, urgente: true });

    // La urgencia es una excepción: al quitarla vuelve el orden automático.
    await cambiarUrgencia(s.usuarios.ENCARGADO, tarde.id, false, null);
    fila = (await colaProduccion()).find((f) => f.productoId === s.productos.ciegoNegro.id)!;
    expect(fila.pedidos.map((p) => p.pedidoId)).toEqual([pronto.id, tarde.id]);
  });
});

describe("Unidades por caja", () => {
  it("todos los pisos usan el parámetro; los accesorios no se embalan", async () => {
    const params = await obtenerParametros();
    expect(unidadesPorCaja({ esAccesorio: false, unidadesPorCaja: null }, params)).toBe(25);
    expect(unidadesPorCaja({ esAccesorio: true, unidadesPorCaja: null }, params)).toBeNull();
    expect(desglosarCajas(60, 25)).toEqual({ cajas: 2, sueltas: 10 });
    expect(desglosarCajas(60, null)).toBeNull();

    await actualizarParametro(s.usuarios.ENCARGADO, "unidades_por_caja_pisos", 20);
    expect(unidadesPorCaja({ esAccesorio: false, unidadesPorCaja: null }, await obtenerParametros())).toBe(20);
    expect((await actualizarParametro(s.usuarios.ENCARGADO, "unidades_por_caja_pisos", 2.5)).error).toBeDefined();
    await actualizarParametro(s.usuarios.ENCARGADO, "unidades_por_caja_pisos", 25);
  });
});

describe("Clientes", () => {
  it("no duplica por mayúsculas y guarda los datos de la compra", async () => {
    const r = await resolverClienteDelPedido({ nombreNuevo: "  CARREFOUR ", telefono: "11 4444 4444", domicilio: "Av. Siempre Viva 742" });
    expect(r).toEqual({ id: s.cliente.id });
    const [c] = await db().select().from(schema.cliente).where(eq(schema.cliente.id, s.cliente.id));
    expect(c).toMatchObject({ telefono: "11 4444 4444", domicilio: "Av. Siempre Viva 742" });

    // Nunca pisa datos ya cargados.
    await resolverClienteDelPedido({ clienteId: s.cliente.id, telefono: "otro", domicilio: "otro" });
    const [c2] = await db().select().from(schema.cliente).where(eq(schema.cliente.id, s.cliente.id));
    expect(c2.telefono).toBe("11 4444 4444");

    const nuevo = await resolverClienteDelPedido({ nombreNuevo: "Juan Pérez", telefono: "11 1111 1111", domicilio: null });
    expect("id" in nuevo && nuevo.id).not.toBe(s.cliente.id);
  });
});

describe("Remitos", () => {
  it("cada entrega genera un remito interno correlativo", async () => {
    const pedidos = await db().select().from(schema.pedido);
    const abiertos = pedidos.filter((p) => p.estado === "PEDIDO").slice(0, 2);
    for (const p of abiertos) {
      await db().update(schema.pedido).set({ estado: "LISTO_PARA_DESPACHAR" }).where(eq(schema.pedido.id, p.id));
      expect((await marcarEntregado(p.id, { numeroRemito: null, usuarioId: s.usuarios.ADMINISTRACION.id })).error).toBeUndefined();
    }
    const numeros = (await db().select().from(schema.despacho)).map((d) => d.numeroInterno).sort();
    expect(numeros).toHaveLength(2);
    expect(numeros[1] - numeros[0]).toBe(1);
  });
});

describe("12. Conservación de históricos", () => {
  it("cambiar configuración no reescribe movimientos ni pedidos, y el historial guarda cada valor", async () => {
    const movimientosAntes = await db().select().from(schema.movimiento);
    const lineasAntes = await db().select().from(schema.pedidoLinea);

    await actualizarMinMaxProducto(s.usuarios.ENCARGADO, s.productos.rejNegro.id, { minimo: 2000, maximo: 2500 });
    await actualizarMinMaxProducto(s.usuarios.GERENCIA, s.productos.rejNegro.id, { minimo: 1800, maximo: 2500 });

    const historial = await listarAuditoria({ entidad: "producto", entidadId: s.productos.rejNegro.id });
    const minimos = historial.filter((h) => h.campo === "minimo").map((h) => [h.valorAnterior, h.valorNuevo]);
    expect(minimos).toEqual([
      ["2000", "1800"],
      ["1500", "2000"],
    ]);
    expect(await db().select().from(schema.movimiento)).toEqual(movimientosAntes);
    expect(await db().select().from(schema.pedidoLinea)).toEqual(lineasAntes);

    // La lista del Panel Admin muestra la última modificación.
    const fila = (await listarMinMaxProductos()).find((p) => p.id === s.productos.rejNegro.id)!;
    expect(fila.ultimaModificacion?.usuarioNombre).toBe("Usuario GERENCIA");
  });
});
