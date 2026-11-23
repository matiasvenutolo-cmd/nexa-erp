# 23 · Cambios del 23/11/2026 (notas del socio después de probar)

Fuente: «cambios nexa 23 de nov.docx» (con captura de Materia prima y foto de
la etiqueta real). Pruebas: `tests/cambios-23-11.test.ts`. Migración 0018 (no
destructiva): tipo de aviso «Material para llevar a pie de máquina» y, en
`novedad_maquina`, el pedido del operario (`pedido`), el OK del Encargado
(`avisado_mp_en/por`) y el descarte (`descartado_en/por`).

## Qué cambió

**Producción (Encargado)**
- En la tanda, los pedidos sólo se informan: ya no se tildan para sacarlos.
- «Asignar día y turno» (antes «máquina, turno y cantidades»): ya no cambia
  cantidades. La receta reforzada se ofrece sólo si el producto la tiene.
- Una tanda nueva queda al final de la secuencia, en gris, con «Falta
  asignar día y turno». Recién con día y turno le llega el aviso a Materia
  prima y aparece en su lista; cada cambio, postergación o cancelación
  también le avisa.
- Pedido de material del operario: «OK, avisar a Materia prima» (recién ahí
  le llega a Daniela) o «Descartar» (desaparece).
- El Encargado ya no registra lo que se lleva a pie de máquina, no hace el
  conteo físico, no ve Compras (menú y pestaña de Producción) ni Clientes.
  Sigue viendo el stock de materia prima y puede cargar la tolva.

**Recetas**
- Filtros por producto (rejilla/ciego), tipo de piso o accesorio y color.
- Explicación de la receta de arranque (cambio de color).

**Materia prima**
- Avisos en su sección «Avisos». El botón «Llevar a pie de máquina» se pinta
  y muestra cuántas tandas faltan.
- «+ Ingreso de proveedor» → «Registrar ingreso de MP».
- La lista para llevar muestra sólo tandas con máquina, día y turno
  (atrasadas, hoy, mañana, próximos días).
- «Registrar lo que se llevó» sin «Piezas previstas»: lo que pide la receta,
  ya precargado. Los pedidos de las máquinas con el OK del Encargado se
  registran desde ahí, precargados con lo que pidió el operario.

**Pantalla del operario**
- «Cargar la tolva» abre el selector con + y −, precargado con la receta; si
  carga distinto, pide el motivo. Se quitó «¿Cargaste la tolva otra vez?».
- «Pedir material»: elige qué y cuánto necesita.

**Etiquetas**
- Formato de la etiqueta real: logo de NEXA y contacto a la izquierda;
  «001B-Rejilla», fecha, partida (5 dígitos), color y cantidad a la derecha;
  código de barras abajo. Sin turno ni operario.

## Preguntas abiertas (responde: Eduardo / David / Daniela)

1. **Receta de arranque** (David): ¿cuánto material extra lleva la primera
   carga al cambiar de color? Hoy sólo se usa si el producto la tiene cargada.
   ¿La quieren o la sacamos?
2. **Contacto en la etiqueta** (Eduardo): se copió de la foto: «Nexa
   soluciones · WhatsApp: + 54 112855-3444 · cotizame.nexa@gmail.com ·
   www.nexasoluciones.com.ar». ¿Está bien el email?
3. **Nombre en la etiqueta** (Eduardo): rejilla dice «001B-Rejilla»; los ciegos
   «040A-Ciego trama» y los accesorios «026-Rejilla rampa». ¿Así?
4. **Encargado y materia prima** (Eduardo): sigue viendo el stock de materia
   prima (sin registrar retiros ni conteos). ¿Está bien?
5. **Pedido del operario** (David): uno por producción hasta que se lleva el
   material o se descarta. ¿Alcanza?
