/**
 * Control de acceso real — reemplaza cualquier selector de rol sin
 * autenticación (el mockup previo no tenía ni eso: las URLs no estaban
 * protegidas en absoluto, docs/01-analisis.md §5 hallazgo 1).
 *
 * Se llama `proxy.ts`, no `middleware.ts`: Next.js 16 renombró el archivo
 * (mismo comportamiento) — ver AGENTS.md y
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
 *
 * `/` queda pública a propósito: es la página de estado del proyecto que ya
 * ve el cliente sin necesidad de cuenta (docs/03-plan-release-1.md). Todo lo
 * demás requiere sesión.
 *
 * Chequeo "optimista" (sólo verifica la firma del JWT, sin ir a la base) —
 * el patrón que recomienda la guía de Next.js para Proxy. El chequeo fuerte
 * (¿el usuario sigue activo?) vive en `getUsuarioActual` (src/lib/session.ts),
 * que sí consulta la base y es lo que efectivamente protege cada pantalla.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verificarSesion } from "@/lib/auth/jwt";
import { HOME_POR_ROL, rutaPermitida } from "@/lib/nav";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/") return NextResponse.next();

  const token = request.cookies.get("nexa_sesion")?.value;
  const sesion = await verificarSesion(token);

  if (pathname === "/login") {
    if (sesion) return NextResponse.redirect(new URL(HOME_POR_ROL[sesion.rol], request.url));
    return NextResponse.next();
  }

  if (!sesion) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!rutaPermitida(sesion.rol, pathname)) {
    return NextResponse.redirect(new URL(HOME_POR_ROL[sesion.rol], request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.png$|.*\\.svg$).*)"],
};
