/**
 * Firma y verificación del token de sesión (JWT stateless en cookie httpOnly).
 *
 * Mismo patrón que reiner-erp (docs/05-backlog-release-2.md §9 de ese
 * proyecto): `jose` + cookie httpOnly + Proxy, en vez de Auth.js/next-auth —
 * evita depender de que una librería de terceros ya soporte las convenciones
 * de Next 16 (`proxy.ts` en vez de `middleware.ts`, ver src/proxy.ts).
 */
import "server-only";
import { SignJWT, jwtVerify } from "jose";
import type { usuario } from "@/lib/db/schema";

type Rol = (typeof usuario.$inferSelect)["rol"];

const SECRET = process.env.AUTH_SECRET;
if (!SECRET) {
  throw new Error("Falta AUTH_SECRET en el entorno — ver .env.example");
}
const encodedKey = new TextEncoder().encode(SECRET);

export type SesionPayload = { usuarioId: number; rol: Rol };

export async function firmarSesion(payload: SesionPayload): Promise<string> {
  return new SignJWT({ usuarioId: payload.usuarioId, rol: payload.rol })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(encodedKey);
}

/** Sólo decodifica y valida la firma — no toca la base. Uso en src/proxy.ts. */
export async function verificarSesion(token: string | undefined): Promise<SesionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, encodedKey, { algorithms: ["HS256"] });
    if (typeof payload.usuarioId !== "number" || typeof payload.rol !== "string") return null;
    return { usuarioId: payload.usuarioId, rol: payload.rol as Rol };
  } catch {
    return null;
  }
}
