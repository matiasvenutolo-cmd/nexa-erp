/**
 * Reunión 10/11/2026 con NEXA: planificación (fechas pasadas, orden dentro del
 * turno, cambio de matriz automático) y código de caja corto.
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
import { actualizarTanda, cancelarTanda, crearTanda, listarTandas, moverTanda } from "@/lib/data/planificacion";
import { hoyISO } from "@/lib/format";
import { yaPaso } from "@/lib/turnos";

let s: Semilla;
const db = () => holder.db!;
const hoy = hoyISO();
const cambiosDe = (tandaId: number) =>
  db().select().from(schema.intervencionMatriz).where(and(eq(schema.intervencionMatriz.tandaId, tandaId), eq(schema.intervencionMatriz.tipo, "CAMBIO_MATRIZ")));

beforeAll(async () => {
  s = await sembrar(await abrirBase());
});
afterAll(cerrarBase);

describe("fechas pasadas", () => {
  it("un día anterior no se puede planificar; la noche de hoy sí", () => {
    expect(yaPaso("2026-01-01", "MANANA", new Date("2026-11-14T15:00:00Z"))).toBe(true);
    expect(yaPaso("2026-11-14", "MANANA", new Date("2026-11-14T21:00:00Z"))).toBe(true); // 18 h en Buenos Aires
    expect(yaPaso("2026-11-14", "NOCHE", new Date("2026-11-14T21:00:00Z"))).toBe(false);
    // A las 3 de la mañana sigue la noche de ayer.
    expect(yaPaso("2026-11-13", "NOCHE", new Date("2026-11-14T06:00:00Z"))).toBe(false);
  });
});

describe("cambio de matriz automático y orden dentro del turno", () => {
  let rejilla: number;
  let ciego: number;
  let rejilla2: number;

  it("al poner un ciego después de una rejilla en la misma máquina se programa el cambio de matriz", async () => {
    rejilla = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejNegro.id, lineas: [], cantidadStock: 40 })).id!;
    ciego = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.ciegoNegro.id, lineas: [], cantidadStock: 40 })).id!;
    expect((await actualizarTanda(s.usuarios.ENCARGADO, rejilla, { fecha: "2026-01-01", turno: "MANANA" })).error).toMatch(/ya pasó/);
    await actualizarTanda(s.usuarios.ENCARGADO, rejilla, { fecha: hoy, turno: "NOCHE" });
    await actualizarTanda(s.usuarios.ENCARGADO, ciego, { fecha: hoy, turno: "NOCHE" });
    const [c] = await cambiosDe(ciego);
    expect(c).toMatchObject({ estado: "PROGRAMADA", inyectora: "8", fechaProgramada: hoy, turno: "NOCHE", matrizAnterior: "Rejilla" });
    expect(await cambiosDe(rejilla)).toHaveLength(0);
  });

  it("dentro del turno se ordena con ↑ ↓ y el cambio de matriz pasa a la que queda segunda", async () => {
    await moverTanda(s.usuarios.ENCARGADO, ciego, "arriba");
    const orden = (await listarTandas()).filter((t) => [rejilla, ciego].includes(t.id)).map((t) => t.id);
    expect(orden).toEqual([ciego, rejilla]);
    expect((await cambiosDe(ciego)).find((c) => c.estado === "PROGRAMADA")).toBeUndefined();
    expect((await cambiosDe(rejilla))[0]).toMatchObject({ estado: "PROGRAMADA", matriz: "Rejilla" });
  });

  it("si la tanda se cancela, su cambio de matriz se cancela", async () => {
    rejilla2 = (await crearTanda(s.usuarios.ENCARGADO, { productoId: s.productos.rejRojo.id, lineas: [], cantidadStock: 10, fecha: hoy, turno: "NOCHE" })).id!;
    await cancelarTanda(s.usuarios.ENCARGADO, rejilla, "prueba");
    expect((await cambiosDe(rejilla))[0].estado).toBe("CANCELADA");
    // Ahora la rejilla roja sigue al ciego: pide cambio de matriz.
    expect((await cambiosDe(rejilla2))[0]).toMatchObject({ estado: "PROGRAMADA", matrizAnterior: expect.stringMatching(/^Ciego/) });
  });
});
