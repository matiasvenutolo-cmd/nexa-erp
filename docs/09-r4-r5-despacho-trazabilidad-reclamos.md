# 09 — Segunda etapa: R4/R5 operativos (despacho, controles, avisos, trazabilidad, reclamos)

Fecha: 05/10/2026. Continúa `docs/08-configuracion-y-panel-admin.md`. Objetivo: que nada quede
"diseñado pero no operativo". Etiquetas siguen fuera de alcance por definición del cliente.

## 1. Auditoría de partida (antes de esta etapa)

| Funcionalidad | Estado | Detalle |
|---|---|---|
| Despacho parcial | 🔴 | Tabla `despacho` sin flujo; `marcarEntregado` cerraba el pedido entero de una vez. |
| Doble piqueo / control | 🔴 | Tabla `piqueo` sin UI ni reglas. |
| Aviso a ventas | 🔴 | No existía. |
| Trazabilidad | 🟡 | `lote_mp`, `caja`, `partida` modelados; sin ingreso de MP, sin cajas, sin consulta. |
| Reclamos | 🔴 | Sólo tabla `devolucion`, sin flujo de supervisor ni informe. |
| Prioridad de inyección | 🟡 | Sólo "urgente sí/no"; sin motivo ni niveles. |
| Master | 🟡 | Cargado en kg/kg y marcado "pendiente de confirmar". |
| Remitos | 🟡 | Correlativo interno al crear el despacho (consumía número aunque no saliera). |
| Pisos 25/caja | 🟡 | Parámetro existía pero el importador ponía overrides de 8 en 94 productos. |

## 2. Qué se implementó

### 2.1 Despacho parcial + doble control (`src/lib/data/despachos.ts`)

Ciclo de vida: **ARMANDO → CONTROLADO → ENTREGADO** (o **ANULADO**).

1. *Preparar despacho* (pedido "en preparación" o parcialmente despachado) → despacho ARMANDO.
2. *Armado / primer control*: se lee cada caja (`P{partida}-C{caja}`) o el código de producto
   (stock sin caja, accesorios). Cada lectura es una fila de `piqueo` (etapa ARMADO) con
   usuario y hora. Las lecturas inválidas quedan registradas **con alerta** y no suman:
   código desconocido, producto que no está en el pedido, caja dada de baja, caja ya armada,
   renglón completo, excede lo pendiente, stock insuficiente, lectura en 0.
3. *Confirmar primer control* → despacho CONTROLADO, `despacho_linea` con lo armado,
   resultado "Completo…/Parcial…", pedido LISTO_PARA_DESPACHAR y **aviso a ventas**.
4. *Control final*: se vuelve a leer todo (etapa CONTROL_FINAL). Sólo se puede confirmar si
   coincide exactamente con lo armado por renglón y caja; si no, la UI bloquea.
5. *Confirmar control final* → despacho ENTREGADO: recién acá **sale el stock** (movimiento
   SALIDA por caja/partida + saldo, en la misma transacción), se consume la reserva, se asigna
   el **remito interno** (`nextval('remito_interno_seq')`) y el pedido pasa a
   PARCIALMENTE_DESPACHADO o ENTREGADO según quede pendiente.
6. Un pedido parcialmente despachado admite un nuevo despacho por lo pendiente; el historial
   de despachos (con controles, quién/cuándo, remitos) se ve en el pedido.
7. Anular un despacho no entregado no toca stock ni consume número de remito.

### 2.2 Remitos
- **Interno**: correlativo automático `R-000001`, asignado al entregar. Impresión original +
  duplicado (`/pedidos/[id]/remito/[despachoId]`).
- **Legal**: número del talonario registrable aparte por Administración/Gerencia, con
  usuario y fecha, auditado. Independiente del interno.

### 2.3 Avisos (`aviso`, `/avisos`)
Un único mecanismo para: pedido listo (→ Administración), reclamo nuevo (→ Supervisor),
informe de reclamo (→ Gerencia). Cada aviso guarda quién lo generó, pedido/despacho/reclamo
vinculado, visto (quién/cuándo) y procesado (quién/cuándo). Contador en el menú lateral.
Gerencia ve todos.

### 2.4 Materia prima (`/materia-prima`)
- Ingreso: certificado de calidad con correlativo propio, lote con código de 27 dígitos
  (los 3 primeros en `000` al ingreso), movimiento ENTRADA + saldo.
- Retiro a máquina: SALIDA + saldo, vinculado al ciclo → `ciclo_materia_prima`. El código
  de uso reemplaza los 3 primeros dígitos por el número de producto.

### 2.5 Producción
- Al cerrar el ciclo se generan las **cajas**: pisos en cajas de `unidades_por_caja_pisos`
  (25, configurable; override por producto si se carga), con caja de resto; accesorios sin
  caja (un solo bulto). "Piezas a stock" pasó a ser obligatorio y validado (≤ producidas).
- La pantalla del ciclo muestra el master aplicado:
  `Master: 0,012 g/kg · Producto: Piso Rejilla · Color: Negro`, la MP usada y las cajas.

### 2.6 Reclamos (`/reclamos`)
Ventas (Administración), Supervisor o Gerencia registran el reclamo sobre un pedido
(opcionalmente caja/partida; se vincula el último despacho). El **Supervisor** es obligatorio
para analizarlo: causa, solución, observaciones; no se puede cerrar sin causa y solución.
Historial de eventos (`reclamo_evento`) y botón "Enviar informe a Gerencia" que genera el
aviso y una vista imprimible (`/reclamos/[id]/informe`). Reemplaza a `devolucion` (vacía).

### 2.7 Trazabilidad (`/trazabilidad`)
En ambos sentidos, por pedido, cliente, caja, partida, lote o certificado:
certificado → lote → retiros/ciclos → partida → cajas → despacho/remito → pedido → cliente,
y al revés.

### 2.8 Prioridad de inyección
Niveles: Urgente (−2), Adelantado (−1), Automática por fecha (0), Postergado (1). La cola
ordena por nivel y luego por fecha de entrega pactada (o fecha de pedido). Cambio manual sólo
Encargado/Supervisor, con motivo obligatorio (urgencia del cliente, planificación, agrupar
colores, reducir cambios de matriz/material, otro + detalle), auditado con valor anterior y
nuevo.

### 2.9 Permisos (validados en el servidor, `src/lib/auth/permisos.ts`)
| Acción | Roles |
|---|---|
| Mín/máx de stock | Encargado, Gerencia |
| Master y parámetros de producción | Encargado, Supervisor, Gerencia |
| Usuarios | Gerencia |
| Prioridad de inyección | Encargado, Supervisor |
| Operar despacho (armado, controles) | Despacho, Encargado, Supervisor, Gerencia |
| Remito legal | Administración, Gerencia |
| Ingreso de MP | Materia prima, Supervisor, Gerencia |
| Retiro de MP | Retiros MP, Materia prima, Encargado, Supervisor, Gerencia |
| Cargar reclamo | Administración, Supervisor, Gerencia |
| Resolver reclamo | Supervisor |
| Trazabilidad | Gerencia, Supervisor, Encargado, Administración, Materia prima |
| Precios | Gerencia, Administración (sin cambios) |

## 3. Master: definición definitiva

El cliente confirmó **gramos de master por kg de materia prima**: Rejilla 0,015 g/kg,
Rejilla Negro 0,012 g/kg, Ciego 0,018 g/kg. Configurable desde Panel Admin → Master.

Migración en dos fases (base compartida local/prod):
1. `0005`: agrega `g_por_kg_mp`, copia los valores (los números eran correctos, la unidad
   no) y deja registro en `auditoria_config` (`X kg/kg` → `X g/kg`). El código nuevo sólo
   usa `g_por_kg_mp`. **Aplicada.**
2. `0006`, después del deploy: elimina `kg_por_kg_mp` y hace `g_por_kg_mp` NOT NULL.
   **Aplicada el 05/10/2026.**

## 4. Decisiones tomadas para avanzar (preguntas abiertas)

| # | Decisión tomada | Pregunta | Responde |
|---|---|---|---|
| 1 | El primer control y el control final **pueden** hacerlos la misma persona; la UI lo señala pero no lo bloquea (nada en la definición pide usuarios distintos). | ¿Deben ser personas distintas? | Gerencia |
| 2 | El stock sale y el remito interno se numera recién en el **control final** (entrega), no en el armado. | ¿Coincide con la operación real? | David |
| 3 | El aviso "pedido listo" va al rol Administración (ventas) al confirmar el primer control. | ¿Alguien más debe recibirlo? | Alejandra |
| 4 | Stock anterior a las cajas y accesorios se piquean por código de producto (sin partida). | — (transitorio hasta que todo el stock tenga caja) | — |
| 5 | Reclamo: lo cargan Administración, Supervisor o Gerencia; sólo el Supervisor lo resuelve. | ¿El Encargado también puede cargarlo? | Gerencia |
| 6 | Niveles de prioridad: Urgente / Adelantado / Automática / Postergado. | ¿Alcanzan esos niveles? | Eduardo |

## 5. Inconsistencias que siguen abiertas
Las de doc 08 §3 puntos 1–7 y 11–13 (nomenclatura de códigos, Rampa vs Borde, iniciales
Celeste/Yute/Blanco, Violeta Obispo, proveedor del Yute, etc.) no se resolvieron porque
dependen del cliente.

## 6. Tests
`tests/r4r5.test.ts` (22): despacho parcial completo con historial y stock sólo por lo
entregado, bloqueo por control final distinto al armado, lecturas inválidas (incl. caja ya
armada / lectura en 0 / ya controlado), avisos visto/procesado, remito interno sólo al
entregar y legal independiente, anulación sin stock ni número, cancelar pedido con despacho
activo, cajas 25 + resto y accesorios sin caja, piezas a stock obligatorias, MP ingreso/
retiro y código de uso, trazabilidad en ambos sentidos, reclamos (supervisor obligatorio,
cierre con causa/solución, informe a Gerencia), permisos. Total del repo: 52 tests.

E2E en navegador contra la base real (05/10/2026), pasos 1–15: pedido multicolor → ingreso
de MP con certificado → retiro a ciclo → producción con cajas → armado → primer control →
aviso → despacho parcial R-000001 (control final bloqueado ante diferencia) → remito legal e
impresión → stock verificado → trazabilidad → segundo despacho R-000002 → pedido ENTREGADO →
reclamo analizado/cerrado/informado → Gerencia recibe el informe → trazabilidad desde el
certificado hasta el cliente. Bugs encontrados en el E2E y corregidos con test: cierre de
ciclo sin "piezas a stock", lectura en 0 de caja ya armada, lista de lecturas que no se
refrescaba, alerta de una etapa visible en la siguiente.
