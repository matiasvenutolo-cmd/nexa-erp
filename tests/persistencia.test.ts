import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", async () => {
  const h = await import("./helpers/db");
  return {
    get db() {
      return h.holder.db;
    },
  };
});

import { abrirBase, cerrarBase, sembrar } from "./helpers/db";
import { actualizarMinMaxProducto, listarMinMaxProductos } from "@/lib/data/stock-config";
import { crearDosificacion, resolverDosificacion } from "@/lib/data/dosificacion";
import { crearColorEspecial, listarColores } from "@/lib/data/colores";
import { actualizarParametro, obtenerParametros } from "@/lib/data/parametros";
import { listarAuditoria } from "@/lib/data/auditoria";

const dir = mkdtempSync(path.join(tmpdir(), "nexa-persistencia-"));

afterAll(async () => {
  await cerrarBase();
  rmSync(dir, { recursive: true, force: true });
});

describe("11. Persistencia después de cerrar y reabrir", () => {
  it("la configuración sobrevive al cierre de la base", async () => {
    const db = await abrirBase(dir);
    const s = await sembrar(db);
    await actualizarMinMaxProducto(s.usuarios.ENCARGADO, s.productos.rejRojo.id, { minimo: 900, maximo: 1200 });
    await crearDosificacion(s.usuarios.ENCARGADO, { familia: "REJILLA", colorId: null, materiaPrimaBaseId: null, gPorKgMp: 0.015 });
    await crearColorEspecial(s.usuarios.ENCARGADO, { nombre: "Naranja Shell", clienteId: s.cliente.id, proveedorMasterId: s.proveedores.berma.id, masterCodigo: "7363" });
    await actualizarParametro(s.usuarios.ENCARGADO, "unidades_por_caja_pisos", 24);
    await cerrarBase();

    // Reabre el mismo directorio — corre las migraciones de nuevo (idempotentes).
    await abrirBase(dir);
    const rojo = (await listarMinMaxProductos()).find((p) => p.id === s.productos.rejRojo.id)!;
    expect(rojo).toMatchObject({ minimo: 900, maximo: 1200 });
    expect(await resolverDosificacion("REJILLA", s.colores.rojo.id)).toMatchObject({ gPorKgMp: 0.015 });
    expect((await listarColores({ texto: "shell" }))[0]).toMatchObject({ especial: true, masterCodigo: "7363", clienteNombre: "Carrefour" });
    expect((await obtenerParametros()).unidades_por_caja_pisos).toBe(24);
    expect((await listarAuditoria()).length).toBeGreaterThanOrEqual(4);
  });
});
