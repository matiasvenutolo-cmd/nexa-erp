"use client";

import { usePathname } from "next/navigation";
import { MessageSquareWarning } from "lucide-react";
import { FormAccion } from "@/components/form-accion";
import { informarErrorAction } from "@/app/actions/avisos";

/**
 * "Informar un error": quien no puede corregir (sólo Supervisión y Gerencia
 * corrigen datos cargados) avisa qué está mal; el aviso llega a Supervisión
 * con la pantalla desde la que se envió.
 */
export function InformarError({ pedidoId }: { pedidoId?: number }) {
  const pathname = usePathname();
  return (
    <details className="text-sm">
      <summary className="btn btn-ghost btn-sm list-none">
        <MessageSquareWarning size={15} /> Informar un error
      </summary>
      <div className="panel mt-2 max-w-md">
        <FormAccion accion={informarErrorAction} ocultos={{ pantalla: pathname, pedidoId }} boton="Enviar a Supervisión" claseBoton="btn btn-azul btn-sm" className="space-y-2">
          <textarea name="descripcion" required rows={3} className="input" placeholder="Qué está mal y cuál es el dato correcto (ej. cargué 3 bolsitas, eran 2)" />
        </FormAccion>
      </div>
    </details>
  );
}
