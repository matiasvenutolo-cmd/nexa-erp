import { asc } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { proveedorMaster } from "@/lib/db/schema";

export async function listarProveedoresMaster() {
  return db.select().from(proveedorMaster).orderBy(asc(proveedorMaster.nombre));
}
