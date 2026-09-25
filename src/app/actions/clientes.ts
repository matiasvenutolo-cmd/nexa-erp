"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import { cliente } from "@/lib/db/schema";

export async function crearClienteAction(formData: FormData) {
  const nombre = String(formData.get("nombre") ?? "").trim();
  if (!nombre) redirect("/clientes/nuevo?error=nombre");

  const cuit = String(formData.get("cuit") ?? "").trim() || null;
  const telefono = String(formData.get("telefono") ?? "").trim() || null;
  const domicilio = String(formData.get("domicilio") ?? "").trim() || null;
  const localidad = String(formData.get("localidad") ?? "").trim() || null;

  try {
    await db.insert(cliente).values({ nombre, cuit, telefono, domicilio, localidad });
  } catch {
    redirect("/clientes/nuevo?error=duplicado");
  }

  revalidatePath("/clientes");
  redirect("/clientes");
}
