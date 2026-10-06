# 10 — Auditoría final integral (05/10/2026)

Sobre el código de `main` + la base real (Neon). Sin funcionalidades nuevas: sólo
corrección de bugs técnicos que no requieren decisiones del cliente.

## 1. Problemas encontrados y corregidos

| # | Problema | Impacto | Corrección | Test |
|---|---|---|---|---|
| 1 | Alta de cliente sin control de sesión ni permiso en el servidor | Un usuario con sesión vieja (rol cambiado) podía crear clientes | `crearClienteAction` valida `puedeCrearPedido` | revisión + E2E |
| 2 | Confirmaciones de despacho sin bloqueo de fila | Doble clic / dos pestañas en "control final" podía descontar el stock dos veces en Postgres real | `SELECT … FOR UPDATE` del despacho en piqueo, primer control, control final, anulación y remito legal; del pedido al abrir despacho | auditoria-final (doble confirmación) |
| 3 | Lectura por código de producto tomaba unidades guardadas en cajas | La misma unidad comprometida dos veces → saldo negativo al entregar | Stock libre sin caja = saldo − armado en curso − contenido de cajas sin comprometer; serializado por producto | auditoria-final + E2E |
| 4 | Cancelar un pedido mientras se confirma su entrega | Pedido entregado quedaba CANCELADO | La anulación propaga el error y se relee el pedido con bloqueo | revisión |
| 5 | Cierre de ciclo validaba "abierto" fuera de la transacción | Doble envío: stock y cajas ingresados dos veces | `UPDATE … WHERE fecha_fin IS NULL RETURNING` dentro de la transacción | auditoria-final (falla con el código anterior) |
| 6 | Alta de ciclo aceptaba cualquier partida | Continuar una partida de otro producto o cerrada rompe la trazabilidad | Valida producto y partida abierta | auditoria-final |
| 7 | Retiros de MP simultáneos | Podían superar lo disponible del lote | Bloqueo del saldo de la MP | revisión |
| 8 | Reclamo con una caja que el pedido nunca recibió | Trazabilidad del reclamo apuntaba a otra partida | Valida que la caja salió en un despacho de ese pedido y vincula ESE despacho | auditoria-final + E2E |
| 9 | Búsqueda por número de lote repetido entre proveedores | Elegía uno al azar | Pide el código completo y lista las opciones | auditoria-final |
| 10 | Corrección manual de stock | Aceptaba fracciones de pieza y dejar saldo negativo | Entero y no negativo, con bloqueo | auditoria-final |
| 11 | "Hoy" calculado en UTC | Después de las 21 h, pedidos, cajas, despachos, retiros y cierres de partida quedaban con la fecha del día siguiente; timestamps mostrados con el día UTC | `hoyISO()` y `fmtDia()` en hora argentina | auditoria-final (fechas) |

Contra el código anterior fallan 7 de los 12 tests nuevos (los demás confirman
comportamiento que ya era correcto o carreras que sólo se dan en Postgres real,
donde la protección es el `FOR UPDATE`).

## 2. Integridad de la base real

Saldo = ledger en todos los ítems, sin saldos negativos, sin despachos activos
duplicados, sin reservas inconsistentes, cajas = piezas a stock de cada ciclo,
sin overrides de unidades por caja, sin clientes ni productos duplicados, 7
migraciones aplicadas, 81 FKs. Datos históricos de la importación del 25/09 que
no se tocaron (no son errores del flujo actual):

- 51 pedidos ENTREGADO con renglones sin `unidades_despachadas` (se importaron
  así, sin despachos).
- 5 pedidos LISTO_PARA_DESPACHAR sin despacho (estado del flujo anterior); se
  pueden despachar normalmente desde la pantalla del pedido.
- 2 renglones abiertos con producto pero sin reserva (#44 y #63, 1 unidad cada
  uno); no afecta el "comprometido", que se calcula sobre lo pendiente.

## 3. Observaciones que no se corrigieron

- **Formularios que se vacían tras un error de validación** (React 19 resetea
  los formularios con `action`): no pierde datos guardados, pero obliga a volver
  a cargar. Afecta varias pantallas; arreglarlo es un cambio transversal.
- **Rol guardado en la sesión**: si Gerencia cambia el rol de un usuario con
  sesión abierta, el menú y el acceso a pantallas siguen el rol viejo hasta que
  vuelva a entrar. Las acciones sí usan el rol actual de la base.
- **Lectura con alerta en control final** de una caja no armada se registra con
  0 unidades (sólo informativo, no suma).
