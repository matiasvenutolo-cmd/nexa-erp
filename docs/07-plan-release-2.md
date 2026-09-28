# Release 2 — Tablero, Pedidos completo, Stock y Producción

> Reemplaza el plan original ("R2 = Stock" seguido de "R3 = Producción" por separado).
> Decisión de Matías del 28/09/2026, a partir de la reunión con Ignacio y el cliente: el
> cliente ya vio la versión vieja completa (`nexa-sigma-nine.vercel.app`) y sigue volviendo a
> ella para hacer comentarios — hay que mostrarle la versión nueva con una parte sustancial
> ya funcionando, no de a un módulo por mes.

## Por qué se fusiona

De la minuta de la reunión (26-28/09/2026): la primera versión a mostrar tiene que incluir
**Tablero → Pedidos → Stock → Producción** como un circuito que se sienta terminado, aunque
liviano. Quedan explícitamente para después — "tienen más dudas de negocio y necesitan mayor
validación" — **Materia prima, Etiquetas, Despacho y Planificación** (R4/R5/R6 sin cambios).

## Qué ya tiene el mockup viejo (relevado el 28/09, sin copiar nada literal)

Para no repetir exploración ni perder algo que el cliente ya usa y valora:

| Pantalla | Qué tiene |
|---|---|
| Tablero | Piezas producidas/descartadas/entregadas a stock/despachadas del mes, producción por producto/color/familia-tipo, despachos por producto, y una franja de estado actual (productos en catálogo, bajo mínimo, materiales de MP, MP bajo mínimo) que no depende del mes elegido |
| Pedidos | Panel "material comprometido a entregar" (por producto: comprometido / stock / falta producir) arriba del listado. **Las filas NO son clickeables — confirmado, da 404** (`/pedidos/1`). Es exactamente el gap que señaló el cliente. |
| Pedidos/nuevo | Mismos campos que ya tenemos, más **N° de comprobante de pago** (nuestro schema ya tiene la columna `numeroComprobante`, sólo falta el campo en el formulario) |
| Stock de productos | Filtros + semáforo — ya lo tenemos en `/catalogo`, prácticamente igual |
| Stock de productos → movimientos | Historial de entradas/salidas/ajustes con filtro por tipo y producto, + corrección manual — **no lo tenemos** |
| Producción | Ciclo en 2 pasos (inicio/fin) + "cola de producción — falta para pedidos" con **la lista de qué pedidos cubre cada faltante** — confirma que un ciclo necesita poder cubrir varios pedidos (ya lo habíamos anotado en `docs/06-comentarios-produccion.md` §3.1) |

## Orden de construcción

**0 · Favicon** ✅ — `src/app/icon.svg`, el ícono de marca que ya gustó del mockup viejo
(fondo azul `#00009F`, swoosh naranja `#FF6100` — son los mismos tokens que ya usa nuestro
`globals.css`, no hay que inventar nada).

**1 · Completar Pedidos** (lo que quedó a medias en R1: sólo se podía crear, nunca avanzar)
- Ciclo de vida real: pasar a EN_ARMADO, marcar LISTO_PARA_DESPACHAR, marcar ENTREGADO.
- **Al marcar entregado, ahí sí se genera el movimiento de SALIDA real** (hasta ahora sólo se
  reservaba al crear el pedido; la reserva nunca se convertía en salida de stock efectiva).
- Editar pedido: líneas, datos comerciales, entrega, observaciones.
- Campo N° de comprobante de pago.
- Panel "Material comprometido a entregar" en el listado.

**2 · Tablero**
- Página de inicio para todos los roles autenticados (hoy "/" es la landing pública; el
  tablero vive en `/tablero` o pasa a ser el home real del shell — a definir en la
  implementación).
- Alcance real, no todo lo del mockup: lo que tenemos datos para mostrar HOY. Producción
  recién tiene datos reales cuando entre el paso 4 — hasta entonces el tablero muestra
  pedidos por estado y alertas de stock; se completa cuando exista producción.
- "No se pretende resolver toda la parte de indicadores en esta instancia" (minuta) — regla 7,
  no rellenar con gráficos vacíos.

**3 · Stock — movimientos**
- Historial de movimientos (ya modelado en `movimiento`), filtrable por tipo y producto.
- Corrección manual de stock, con motivo, generando su propio movimiento AJUSTE.

**4 · Producción**
- Requiere el ajuste de schema ya anotado en `docs/06-comentarios-produccion.md` §3.1:
  `cicloProduccion` pasa de un FK simple a `pedidoId` a una tabla `ciclo_pedido` (N:M), porque
  un ciclo tiene que poder cubrir varios pedidos a la vez, por prioridad.
- Ciclo en 2 pasos (inicio/fin), como ya está diseñado.
- Cola de producción — falta para pedidos, con el detalle de qué pedidos cubre cada faltante.
- **Bloqueado por la pregunta 13** (docs/01-analisis.md, "NEXA — Definiciones pendientes"):
  ¿carga por día o por ciclo libre? Mientras no haya respuesta del cliente, se construye bajo
  la última decisión confirmada (ciclo libre, reunión del 16/09) — reversible, documentado,
  no se espera la respuesta para avanzar.

## Fuera de esta entrega, sin cambios

Materia prima, Etiquetas, Despacho, Planificación — R4/R5/R6, en ese orden, después de esta
entrega y con las preguntas de negocio que todavía faltan resolver.
