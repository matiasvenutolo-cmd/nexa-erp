/**
 * Base de prueba: PGlite (Postgres compilado a WASM, en proceso) con las
 * migraciones reales de drizzle/. Los módulos de src/lib/data importan `db`
 * de "@/lib/db/client"; cada archivo de test lo redirige acá con vi.mock,
 * así se prueba la lógica real del ERP sin tocar la base de producción.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";

type Db = PgliteDatabase<typeof schema>;

export const holder: { db: Db | null; client: PGlite | null } = { db: null, client: null };

export async function abrirBase(dataDir?: string): Promise<Db> {
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  holder.client = client;
  holder.db = db;
  return db;
}

export async function cerrarBase(): Promise<void> {
  await holder.client?.close();
  holder.client = null;
  holder.db = null;
}

export type Semilla = Awaited<ReturnType<typeof sembrar>>;

/** Datos mínimos con la forma de los reales: depósito, un usuario por rol,
 *  proveedores, colores, productos de rejilla/ciego y sus saldos. */
export async function sembrar(db: Db) {
  const [deposito] = await db.insert(schema.deposito).values({ nombre: "NEXA" }).returning();

  const roles = schema.rolEnum.enumValues;
  const usuarios = Object.fromEntries(
    await Promise.all(
      roles.map(async (rol) => {
        const [u] = await db
          .insert(schema.usuario)
          .values({ nombre: `Usuario ${rol}`, email: `${rol.toLowerCase()}@test`, rol, passwordHash: "x:y" })
          .returning();
        return [rol, { id: u.id, rol: u.rol }] as const;
      }),
    ),
  ) as Record<(typeof roles)[number], { id: number; rol: (typeof roles)[number] }>;

  const [berma, arcolor] = await db
    .insert(schema.proveedorMaster)
    .values([
      { nombre: "Berma", inicial: "B" },
      { nombre: "Arcolor", inicial: "A" },
    ])
    .returning();

  const [negro, blanco, rojo, azul] = await db
    .insert(schema.color)
    .values([
      { nombre: "Negro", iniciales: "NE", oficial: true },
      { nombre: "Blanco", iniciales: "BL", oficial: true },
      { nombre: "Rojo", iniciales: "RO", oficial: true },
      { nombre: "Azul Oscuro", iniciales: "AO", oficial: true },
    ])
    .returning();

  const [copo2240, copo2630] = await db
    .insert(schema.materiaPrima)
    .values([
      { codigoInterno: "31", nombre: "31-COPOLIMERO 2240 P", tipo: "VIRGEN", minimo: "3000", maximo: "5000" },
      { codigoInterno: "3", nombre: "3-Polipropileno COPOLIMERO COD:2630PC", tipo: "VIRGEN" },
    ])
    .returning();

  const base = { tipoCodigo: "PR", m2PorUnidad: "0.16", kgPorUnidad: "0.610", piezasPorGolpe: 1 } as const;
  const [rejNegro, rejBlanco, rejRojo, ciegoNegro, esqNegro] = await db
    .insert(schema.producto)
    .values([
      { ...base, numero: "001", codigo: "001B-PR-NE", descripcion: "001B-Rejilla -Unico - Negro", familia: "REJILLA", tipo: "UNICO", colorId: negro.id, proveedorMasterId: berma.id, minimo: 1500, unidadesPorCaja: 8 },
      { ...base, numero: "004", codigo: "004A-PR-BL", descripcion: "004A-Rejilla -Unico - Blanco", familia: "REJILLA", tipo: "UNICO", colorId: blanco.id, proveedorMasterId: arcolor.id, minimo: 500, unidadesPorCaja: 8 },
      { ...base, numero: "008", codigo: "008B-PR-RO", descripcion: "08B-Rejilla -Unico - Rojo", familia: "REJILLA", tipo: "UNICO", colorId: rojo.id, proveedorMasterId: berma.id, minimo: 500 },
      { ...base, tipoCodigo: "PM", numero: "031", codigo: "031B-PM-NE", descripcion: "031B-Ciego - Moneda - Negro", familia: "CIEGO", tipo: "MONEDA", colorId: negro.id, proveedorMasterId: berma.id },
      { tipoCodigo: "ER", piezasPorGolpe: 4, numero: "011", codigo: "011B-ER-NE", descripcion: "011B-Rejilla -Esquinero - Negro", familia: "REJILLA", tipo: "ESQUINERO", colorId: negro.id, proveedorMasterId: berma.id, esAccesorio: true },
    ])
    .returning();

  await db.insert(schema.saldo).values([
    { depositoId: deposito.id, productoId: rejNegro.id, cantidad: "0" },
    { depositoId: deposito.id, productoId: rejBlanco.id, cantidad: "520" },
    { depositoId: deposito.id, productoId: rejRojo.id, cantidad: "168" },
    { depositoId: deposito.id, productoId: ciegoNegro.id, cantidad: "230" },
    { depositoId: deposito.id, productoId: esqNegro.id, cantidad: "643" },
    { depositoId: deposito.id, materiaPrimaId: copo2240.id, cantidad: "6975" },
  ]);

  const [cliente] = await db.insert(schema.cliente).values({ nombre: "Carrefour" }).returning();

  return {
    deposito,
    usuarios,
    proveedores: { berma, arcolor },
    colores: { negro, blanco, rojo, azul },
    materiaPrima: { copo2240, copo2630 },
    productos: { rejNegro, rejBlanco, rejRojo, ciegoNegro, esqNegro },
    cliente,
  };
}
