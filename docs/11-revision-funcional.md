# 11 — Revisión funcional previa a la entrega (06/10/2026)

Correcciones técnicas y de UX sobre lo ya implementado. No se agregaron reglas
de negocio nuevas; donde hizo falta una regla se usó la que ya estaba definida.

## 1. Problemas encontrados y correcciones

| # | Punto | Problema real | Corrección |
|---|---|---|---|
| 1 | Menú | Lista plana sin agrupar | Secciones Ventas (Pedidos, Stock / Productos, Clientes, Reclamos), Fábrica (Producción, Materia prima, Trazabilidad) y Administración (Panel Admin). Rutas y permisos sin cambios (test). |
| 2 | Inyectora | Texto libre; nada impedía cargar una baldosa en otra máquina | Baldosas: inyectora 8 fija. Accesorios: lista 1–8 (las máquinas de la planilla real "CARGA INYECTORAS"). Validado en el servidor: una baldosa con otra inyectora se rechaza. |
| 3 | Partida / ciclo | "Partida nueva" sin número visible; continuar era opcional y escondido; el retiro de MP pedía elegir un ciclo sin guía | El alta muestra qué se produce (color, material base, master), la máquina, y la partida: por defecto continúa la abierta (con los golpes del último cierre) o muestra el N° que se asignará. No se puede continuar una partida con el ciclo anterior sin cerrar. El ciclo muestra los pasos (inicio → retiro de MP → cierre) y el botón "Retirar materia prima para este ciclo"; el retiro vuelve al ciclo y toma su inyectora. |
| 4 | Cantidades | "Pedidos que cubre" con cantidad editable y "Piezas a stock" al cierre, sin explicar la relación | Respuesta técnica: todo lo producido entra al stock general en cajas; cada pedido toma sus unidades al armar el despacho; la cantidad del inicio es planificación (no reserva). El alta muestra pendiente / stock / falta producir; el cierre calcula "piezas que entran a stock" (= producidas − descartadas) y muestra el destino: cuánto cubre de los pedidos y cuánto queda libre. |
| 5 | "Lote" | Ambiguo | Es el lote de materia prima del proveedor (`lote_mp`). Se rotula "Lote de MP (código)" y se muestra aparte el "N° de lote del proveedor"; la partida NEXA se rotula "Partida NEXA". |
| 6 | Stock | Tabla única extensa | Productos: segmentos Pisos / Accesorios × Rejilla / Ciego, búsqueda, solo alertas, agrupado por sección. Materia prima: los movimientos a máquina pasan arriba (con ciclo, partida e inyectora), stock por tipo (Virgen, Master, …) con búsqueda. |
| 7 | "Listo para despachar" | El sistema sólo lo asigna al confirmar el primer control (correcto), pero el importador traducía "listo para retirar" del Excel a ese estado: 5 pedidos lo mostraban sin armado y uno necesitaba producción | Importador corregido. La lista de pedidos tiene la columna "Situación" (datos pendientes / falta producir N / stock disponible para armar / armado y controlado) y marca "Estado importado sin armado"; el detalle avisa la inconsistencia. La normalización de esos 5 pedidos queda pendiente de autorización (modifica datos reales). |
| 7b | Disponibilidad | Cada pedido descontaba las reservas de los demás: dos pedidos que compiten mostraban faltantes que sumaban más que el faltante real | El stock se reparte con el orden de la cola de producción (prioridad y fecha). Lista, detalle y "Material comprometido" muestran el mismo faltante (test). |
| 8–10 | Asignar | "Asignar" ofrecía cualquier producto a renglones del Excel con texto libre ("gris oscuro y violeta") | Se llama "Vincular al producto del catálogo". Texto con varios colores: dato pendiente, no se vincula. Color reconocible: sólo productos de ese color (validado también en el servidor). Texto que no identifica un color: dato pendiente. Sin dato de color: exige registrar cómo se confirmó. La asignación de stock a un pedido sigue siendo la lectura de cajas en el armado, que sólo acepta el producto exacto. |
| 11 | Remitos | Existían pero dispersos en la tarjeta de cada despacho | Tabla "Remitos" en el pedido: remito interno, fecha, estado, remito legal, quién y cuándo lo registró, e impresión original/duplicado. |

## 2. Correcciones de datos reales (autorizadas, 06/10/2026)

Aplicadas en una sola transacción, con fila de auditoría en cada cambio:

- Pedidos #44, #47, #51, #54 y #56: "Listo para despachar" (importado del
  Excel, sin despacho ni entregas) → "Pedido".
- Pedido #54, renglón "GRIS OSCURO Y ROJO": se revirtió la vinculación a
  007B-PR-VC (Rejilla Verde Claro) hecha el 06/10 09:13; la reserva quedó
  LIBERADA. El otro renglón del #54 (sin color, vinculado a 078A-PR-YU) no se
  tocó: no hay dato para validarlo.
- Se borraron los datos de la prueba de punta a punta (pedido #84 y todo lo
  asociado) y se restauraron los saldos; saldo = ledger en todos los ítems.

## 3. Tests

72 en total (8 nuevos en `tests/revision-funcional.test.ts`; el test de
vinculación de renglones se reescribió porque validaba el comportamiento
incorrecto).

## 4. Pendientes que requieren definición del cliente

Sin cambios respecto de doc 10: controles por personas distintas, quién
modifica mínimos, código oficial, Rampa/Borde, iniciales, Violeta Obispo,
proveedor del Yute, talonario preimpreso, PDF del certificado. Se suma: la
cantidad por color de los renglones multicolor del Excel.
