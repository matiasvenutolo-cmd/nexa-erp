# 08 — Configuración, Panel Admin y respuestas a "Definiciones pendientes"

> Fuentes: `NEXA - Definiciones pendientes.docx` respondido por el cliente (05/10/2026),
> `data/codigos.xlsx` (hojas `colores`, `minimos Materia prima`, `minimos en pisos`) y las
> definiciones del audio. Carga aplicada: `docs/migracion-configuracion.md`.

## 1. Qué había antes de este cambio

| Tema | Estado encontrado | Dónde |
|---|---|---|
| Semáforo de stock | Leía `producto.minimo/maximo`, pero el margen de "Bajo" era un `* 1.15` fijo. Ningún producto tenía máximo. | `src/lib/data/stock.ts` |
| Mínimos/máximos | Sólo se cargaban con el importador; no había pantalla para editarlos ni historial. | `scripts/import-excel.ts` |
| Master por kg | Tabla `ratio_master` vacía y sin uso; ningún cálculo la leía. | schema |
| Unidades por caja | Hardcodeado `Rejilla 8 / Ciego 25`, también para accesorios. Los 94 productos quedaron con 8 o 25. | `src/lib/data/catalogo.ts`, importador |
| Colores | Únicos por nombre exacto (sensible a mayúsculas). "Color a medida" se guardaba sin solicitante, proveedor ni master. Un renglón "Otro color" podía guardarse como texto libre sin producto. | `catalogo.ts`, formulario de pedido |
| Prioridad de inyección | `pedido.prioridad` existía (todo en 0). La cola ordenaba por volumen faltante, no por fechas. El formulario no pedía fecha de entrega. | `pedidos.ts`, `produccion.ts` |
| Remitos | Número opcional, tipeado a mano, sin correlativo. | `marcarEntregado` |
| Clientes | "JUAN PÉREZ" y "Juan Pérez" generaban dos clientes; los datos del pedido no quedaban en el cliente. | `crearPedidoAction` |
| Usuarios | Sin pantalla de administración (sólo script de seed). | — |
| Auditoría | No había historial de cambios de configuración (sólo el ledger de stock). | — |
| Tests | No había. | — |

## 2. Qué se cambió

### Migraciones (Neon, aplicadas el 05/10/2026 — todas aditivas salvo la primera)

- `0002_quita_ratio_master`: borra `ratio_master` (0 filas, ningún código la leía). Va en una
  migración propia para que la siguiente no confunda "tabla nueva" con "tabla renombrada".
- `0003_panel_admin_configuracion`:
  - `color`: `clave` (columna generada: nombre normalizado, índice único), `especial`,
    `cliente_id` (solicitante), `proveedor_master_id`, `master_nombre`, `master_codigo`,
    `master_materia_prima_id`, `observaciones`, `creado_en`, `creado_por_id`.
  - `producto.codigo_barras` (código de la lista oficial del cliente; no reemplaza `codigo`).
  - `dosificacion_master` (familia + color opcional + MP base + kg/kg; único por familia+color,
    `NULLS NOT DISTINCT`).
  - `parametro` (globales) — carga `semaforo_margen_bajo = 0.15` (el valor que estaba fijo en
    el código) y `unidades_por_caja_pisos = 25` (respuesta 4).
  - `auditoria_config` (quién, cuándo, campo, valor anterior, valor nuevo, motivo).
  - `despacho.numero_interno` correlativo (secuencia `remito_interno_seq`).
  - Índice único `lower(btrim(cliente.nombre))`.

Ninguna migración agrega una columna NOT NULL que el código ya desplegado no sepa llenar: la
base es compartida entre local y producción.

### Parámetros que ahora son configurables (Panel Admin)

| Parámetro | Alcance | Dónde se usa |
|---|---|---|
| Mínimo / máximo de producto | por producto | semáforo (Stock - Productos, Tablero, Panel Admin) |
| Mínimo / máximo de materia prima | por MP | semáforo de MP en Panel Admin |
| Margen de "Bajo" del semáforo | global | `semaforoStock()` — único cálculo del semáforo |
| Unidades por caja de pisos | global, con excepción por producto (`producto.unidades_por_caja`) | detalle del pedido: cajas cerradas + sueltas |
| Master por kg | por tipo de producto (base) + excepción por color | detalle del ciclo de producción |
| Ficha de color (proveedor, master, solicitante, especial) | por color | formulario de pedido, Panel Admin |

Ningún componente ni servicio tiene un valor por defecto para estos parámetros: si falta un
parámetro global en la base, el sistema lo informa en vez de inventar un número.

### Permisos (`src/lib/auth/permisos.ts`)

| Acción | Roles | Fuente |
|---|---|---|
| Mínimos y máximos | Encargado, Gerencia | Resp. 3 "solo para Encargado" + tabla "a consideración de gerencia" — ver §4 |
| Master y parámetros generales | Gerencia, Supervisor, Encargado | sin definición explícita; mismo criterio que cargar producción |
| Colores (incl. registrar especial) | Gerencia, Supervisor, Administración, Encargado | mismo criterio que dar de alta producto desde el pedido |
| Usuarios | Gerencia | sin definición explícita |
| Prioridad manual (urgencia) | Encargado, Supervisor | "con opción a ser cambiada por el encargado o supervisor" |

Los permisos se validan en la capa de servicios (`src/lib/data/*`), no sólo en el menú ni en
el proxy. La regla de precios (de supervisor para abajo nadie ve precios) no se tocó.

### Funcionalidad

- **Panel Admin** (`/admin`): Stock (productos y MP), Master, Colores, Parámetros, Usuarios,
  Historial. Cada rol ve sólo las secciones que puede editar.
- **Colores especiales**: el "Otro (color especial)" del pedido registra el color con el
  cliente del pedido como solicitante, proveedor y master; si ya existe (sin importar mayúsculas
  o acentos) se reutiliza con su master. También se registran desde el Panel Admin.
- **Pedidos multicolor**: cada renglón tiene que ser un producto (validado en la capa de datos).
  Un nombre como "Negro, blanco y rojo" se rechaza. Se ocultan los grupos sin productos.
- **Prioridad de inyección**: automática por fecha de entrega comprometida (o fecha del
  pedido); el Encargado/Supervisor marca "urgente" con motivo auditado. La cola de producción
  ordena así y muestra qué pedidos espera cada producto.
- **Remitos**: cada entrega genera un remito interno correlativo `R-000001`; el N° de remito
  legal preimpreso se registra aparte si se usa.
- **Clientes**: un cliente "nuevo" con nombre existente reutiliza el registro; teléfono y
  domicilio del pedido completan los datos vacíos del cliente (nunca pisan).
- **Producto de color especial**: copia m², kg y piezas por golpe de un producto de la misma
  familia y tipo (antes eran números fijos en el código).

### Tests (`npm test`, vitest + PGlite con las migraciones reales)

31 tests: mínimo, máximo, recálculo del semáforo (incl. margen como parámetro y casos borde),
master base y excepción, alta y reutilización de color especial, pedido multicolor, permisos
del Encargado y de quienes no deben configurar, persistencia tras cerrar y reabrir la base,
conservación de históricos, prioridad automática + urgencia, unidades por caja, clientes y
remito correlativo.

## 3. Inconsistencias encontradas (Word ↔ Excel ↔ código)

1. **Código de producto**: el Excel usa otra nomenclatura (`001B-RU-NE`, `011B-RE-NE`,
   `021B-RB-NE`, `031B-CM-NE`...) que el código derivado del sistema (`001B-PR-NE`,
   `011B-ER-NE`, `021B-RR-NE`, `031B-PM-NE`). No se reemplazó: se guardó en
   `producto.codigo_barras` y se muestra al lado.
2. **Rampa vs Borde**: los productos 021–030 y 058–066 son "Rampa" en el sistema (importados
   así) y "Borde" en el Excel nuevo. No se renombró nada.
3. **Iniciales dentro del propio Excel**: Celeste `CE` (hoja colores) vs `C` (hoja pisos);
   Yute `YU` vs `YT`; Blanco `BL` vs `B`. El código de barras del 009 quedó sin cargar por
   esa contradicción.
4. **Columna NUMERO**: la fila de `012B-RE-GO` dice `021B-`. Se tomó el número del código.
5. **Espacio en un código**: `033B- CM-GO` se guardó como `033B-CM-GO`.
6. **Cantidad de colores**: el Word habla de "la lista de 12 colores"; la hoja `colores` trae
   13. Violeta Obispo (productos 200–202) no está en ninguna lista oficial: quedó "sin
   clasificar".
7. **Proveedor del Yute**: figura como "YUTE" (no es un proveedor); el master es A14, prefijo
   de Arcolor. Quedó sin proveedor en la ficha del color.
8. **Unidad del master**: el Word dice "0.015 **gramos** por kilo"; el mismo documento, en la
   pregunta, decía "150 gramos cada 10 kilos (0,015 kg por kg)". 0,015 g/kg sería mil veces
   menos. El sistema ya trabajaba en kg/kg (`kg_por_kg_mp`): se cargó 0,015 / 0,012 / 0,018
   kg/kg y la pantalla muestra la equivalencia en g/kg. Pendiente de confirmar la unidad.
9. **Quién cambia mínimos**: "solo para Encargado" (respuesta 3) vs "a consideración de
   gerencia" (tabla de asunciones). Se habilitó a ambos.
10. **"Lo que ya está resuelto"**: el Word marca como implementados el despacho parcial, el
    doble piqueo, el aviso a ventas y la trazabilidad completa. En el código esas piezas
    están **diseñadas en el modelo** (tablas `despacho`, `piqueo`, `devolucion`, `lote_mp`,
    `caja`) pero **no implementadas**: son R4/R5. No se tocaron ni se rompieron.
11. **Mínimos iguales a máximos**: 045B, 046B, 037A, 038A tienen 500/500. Se cargaron tal cual.
12. **MP con 0/0** (38, B3, B4, B5): el semáforo los toma como "no controlados".
13. **Ítems del Excel que no son productos del sistema**: 067 Grampa, cajas 100 y 101; MP A10,
    A17, 161 y 110. No se crearon.

## 4. Preguntas abiertas para el cliente

| # | Pregunta | Responde |
|---|---|---|
| 1 | ¿El código oficial pasa a ser el del Excel (RU/RE/RB/CM/CT/CE/CB)? ¿Y Celeste es `CE` o `C`, Yute `YU` o `YT`? | Eduardo |
| 2 | Los productos 021–030 y 058–066, ¿son "Rampa" o "Borde"? | Eduardo |
| 3 | Master: ¿0,015 **kg** por kg (15 g por kg)? | Eduardo |
| 4 | Mínimos: ¿sólo el Encargado, o también Gerencia? | Gerencia |
| 5 | Violeta Obispo: ¿es un color especial? ¿De qué cliente? | Alejandra |
| 6 | Proveedor del master del Yute (figura "YUTE"). | Daniela |
| 7 | Inyectora: la respuesta 5 dice baldosas sólo en la 8 y accesorios en cualquiera. ¿Lo validamos en el alta de ciclo? (hoy es texto libre) | David |
| 8 | Registro de reclamos: el Word lo propone ("podríamos implementar"). La tabla `devolucion` cubre parte. ¿Entra en la próxima etapa? | Gerencia |
| 9 | Remito por duplicado: ¿se imprime el remito del sistema o el preimpreso? Para el preimpreso hacen falta las medidas. | Alejandra |

## 5. Qué no se modificó (ya estaba bien o fuera de alcance)

- Ledger de stock (`movimiento` + `saldo`), reservas, ciclo de vida del pedido, producción por
  día con continuidad de partida y número de partida automático.
- Regla de precios por rol.
- Código de barras de MP (primeros 3 dígitos en 0): todavía no hay módulo de MP (R4); no hay
  nada que corregir.
- Etiquetas: fuera de esta etapa por definición del cliente.
- Reclamos: no se implementó (ver pregunta 8). Remito impreso por duplicado: pendiente
  (pregunta 9).
- Líneas históricas sin producto (73, del Excel viejo): se conservan tal cual.
