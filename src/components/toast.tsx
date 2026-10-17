"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";

/**
 * Mensaje temporal de éxito: aparece, se va solo a los pocos segundos y limpia
 * el parámetro de la dirección para que no vuelva a mostrarse al recargar.
 */
export function Toast({ mensaje, parametros, duracion = 4000 }: { mensaje: string; parametros: string[]; duracion?: number }) {
  const [visible, setVisible] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      const q = new URLSearchParams(sp.toString());
      for (const p of parametros) q.delete(p);
      router.replace(`${pathname}${q.toString() ? `?${q}` : ""}`, { scroll: false });
    }, duracion);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!visible) return null;
  return (
    <div role="status" aria-live="polite" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-xl bg-[var(--estado-ok-fg)] px-4 py-3 text-sm font-semibold text-white shadow-xl">
      <CheckCircle2 size={18} /> {mensaje}
    </div>
  );
}
