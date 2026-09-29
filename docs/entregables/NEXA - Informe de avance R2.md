# NEXA — Informe de avance (Ronda 2)

**Tablero, Pedidos completo, Stock y Producción** · Septiembre 2026

---

## Resumen

Esta entrega agrega las tres piezas que faltaban para que el circuito se sienta completo:
**Tablero** (pantalla de entrada), **Pedidos** con su ciclo de vida real (antes sólo se podía crear,
no avanzar), **Stock** con historial de movimientos, y **Producción** — alta y cierre de ciclos de
inyección, con la cola de lo que falta producir para cubrir pedidos.

**https://nexa-erp-two.vercel.app** (mismos usuarios y contraseña provisoria de la entrega
anterior).

## Qué se hizo

- **Tablero** — primera pantalla al entrar. Pedidos por estado, alertas de stock y qué falta
  producir para cubrir lo pedido. Cada rol ve sólo los paneles que le sirven.
- **Pedidos, ciclo completo** — pasar a armado, marcar listo, marcar entregado (ahí se descuenta el
  stock real por primera vez; antes sólo se reservaba) y cancelar (libera la reserva sin tocar
  stock). Se puede editar los datos comerciales de un pedido ya cargado.
- **Alta de color a medida** desde el propio pedido, con código asignado automáticamente.
- **Stock — historial de movimientos**, filtrable por producto y tipo, más corrección manual con
  motivo (queda auditada como un movimiento más, no se edita el stock "a mano por atrás").
- **Producción** — alta de ciclo (inicio) y cierre (fin) por día, como se definió con Ignacio: el
  operario cierra la jornada aunque siga con el mismo color al día siguiente; el sistema sugiere
  automáticamente dónde retomar (golpes de inicio = golpes de fin del día anterior) y agrupa todo
  bajo la misma partida, que ahora **la genera el sistema, no se tipea** (pregunta 3 de
  "Definiciones pendientes" — queda resuelta). El cierre genera el descuento de material y el
  ingreso a stock real. Un ciclo puede cubrir varios pedidos a la vez, elegidos por prioridad.
- **Menú lateral** con Producción como sección propia, visible sólo para Gerencia, Supervisor y
  Encargado — administración y el resto de los roles no la necesitan para su tarea diaria.

## Cómo lo probamos

Recorrido punta a punta contra el sistema real (no una copia de prueba), con los usuarios reales de
cada rol:

- **Permisos**: confirmado que Administración no ve ni puede entrar a Producción por URL directa;
  que Despacho no puede crear pedidos ni entrar a Catálogo; que sólo Gerencia y Administración ven
  precios.
- **Pedido completo**: alta → reserva de stock → armado → listo → entregado. Confirmado que recién
  al entregar se genera el movimiento real de salida y el stock baja (antes quedaba sólo reservado).
- **Cancelación**: confirmado que libera la reserva sin tocar el stock.
- **Edición** de un pedido ya cargado.
- **Corrección manual de stock**: sube y baja, queda en el historial con el motivo.
- **Producción, dos días seguidos** con el mismo color: se generó la partida sola, el segundo ciclo
  ofreció continuarla y sugirió el golpe de inicio correcto, y el cierre generó el movimiento de
  entrada y el stock real — verificado directamente contra la base.
- **Celular**: Tablero, Pedidos y Producción, con el menú y las tablas anchas navegables con scroll
  horizontal.

Todos los datos de prueba se cargaron con un cliente ficticio ("PRUEBA QA") y se borraron al
terminar — no queda nada de prueba mezclado con los pedidos reales.

No encontramos errores que bloqueen el uso.

## Qué falta

- **Fuera de esta ronda, sin cambios**: Materia prima y trazabilidad, Etiquetas, Despacho con
  piqueo parcial real, Planificación semanal — en ese orden, después de esta entrega.
- **Editar los ítems de un pedido ya cargado** (hoy sólo se editan los datos comerciales, no
  agregar/quitar productos) — queda para la próxima ronda.
- **Calibrar el semáforo de stock** con mínimos y máximos reales (pregunta 8, sigue pendiente: hoy
  70 de 94 productos aparecen en rojo porque son los valores del Excel viejo).

## Preguntas para la próxima visita

1. **¿Cuál es la inyectora real de NEXA?** El alta de ciclo pide elegirla escribiéndola — hoy no
   hay una lista fija porque no sabemos si es una sola máquina o varias, ni si cambia según el
   producto (pregunta 10 de "Definiciones pendientes").
2. **Mínimos y máximos reales de cada producto** (pregunta 8) — es la que más frena, porque sin
   esto el semáforo de Tablero y Producción no sirve para priorizar.
3. Las demás preguntas de "NEXA — Definiciones pendientes" siguen abiertas y no cambiaron con esta
   entrega (colores oficiales, base de clientes completa, unidades por caja).
