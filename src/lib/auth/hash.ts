/**
 * Hash de contraseñas y PIN de operario.
 *
 * `usuario.passwordHash` / `usuario.pinHash` ya estaban en el schema desde el
 * arranque del proyecto (ver docs/02-modelo-datos.md), pero hasta ahora nada
 * los llenaba — la "sesión" era sólo un selector de rol sin credenciales
 * (RF-12 como wayfinding). Ver docs/05-backlog-release-2.md §6.
 *
 * `scrypt` (nativo de Node, sin dependencia extra) en vez de bcrypt: evita el
 * binding nativo de bcrypt, que complica el build en Vercel sin aportar nada
 * que no dé ya scrypt con parámetros por defecto razonables.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(secret, salt, KEY_LEN)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifySecret(secret: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = (await scryptAsync(secret, salt, KEY_LEN)) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
