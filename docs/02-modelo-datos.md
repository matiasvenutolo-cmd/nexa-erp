# NEXA — Modelo de datos

> La fuente de verdad es `src/lib/db/schema.ts`. Este documento explica **por qué** el esquema es
> así, contra los hallazgos de `01-analisis.md`. Si los dos discrepan, manda el schema y este
> documento está desactualizado.

El modelo se construye completo desde R1 en lo estructural (depósitos, ledger, auditoría), aunque
las pantallas de cada área lleguen en su release. La razón está en §7.1 de `01-analisis.md`:
agregar depósito o auditoría después obliga a reescribir todos los movimientos históricos.

## 1. Identidad y acceso

### `usuario`
Personas reales del organigrama (§3.10). `rol` es un enum de los 8 roles del procedimiento más
`GERENCIA` y `OPERARIO`.

Dos formas de entrar, como en REINER: **email + contraseña** para administración, supervisión y
gerencia; **PIN** para los operarios de planta, que entran desde la PC de inyectora sin teclear
un mail. `puedeVerPrecios` sale del rol, no es un campo (la regla del cliente: de supervisor para
abajo, nadie ve precios).

### `sesion`
Cookie firmada con `jose`. No hay estado de sesión en base salvo el registro de login para
auditoría.

## 2. Catálogo

### `proveedorMaster`
`nombre` + `inicial` (B = Berma, A = Arcolor, P = Platsur). Existe como entidad porque el
proveedor **forma parte de la identidad del producto** (§3.1): mismo color de dos proveedores son
SKUs distintos y no son intercambiables.

### `color`
`nombre` + `iniciales` (NE, AO, AC…). Tabla propia, no string. Resuelve de raíz el problema de
"Azul Oscuro" / "azul oscuro" / "AZUL OSCURO". **Pendiente de la pregunta 2 del cliente.**

### `producto`
Los ~95 SKUs. El `codigo` **se deriva** de sus cuatro componentes, nunca se tipea:

    numero + proveedorMasterInicial + '-' + tipoCodigo + '-' + colorIniciales
    001      B                            PR              NE           →  001B-PR-NE

No es una columna generada de Postgres porque los componentes (inicial del
proveedor, iniciales del color) viven en otras tablas — se calcula en
`construirCodigoProducto()` (`src/lib/data/catalogo.ts`) al insertar o editar.
La identidad real del SKU la garantiza un índice único sobre
`(familia, tipo, colorId, proveedorMasterId)`: dos productos con esos cuatro
valores iguales son, por definición, el mismo producto.

Atributos físicos, todos con valor real de §3.9: `m2PorUnidad`, `kgPorUnidad`, `piezasPorGolpe`,
`unidadesPorCaja`, `pesoCajaKg`. `minimo` / `maximo` quedan nullable hasta la pregunta 1.

### `recetaProducto`
El BOM. Una fila por componente: producto → materia prima + porcentaje. Rejilla lleva una
(100 % Copolímero 2240P), Ciego lleva dos (50/50 Copolímero 2630PC + Plastomer). El master se
calcula aparte, como ratio sobre el total de MP (§3.9), porque depende del color y no del producto.

> Se carga en R4, pero la tabla existe desde R1 para que el cálculo de faltante de R2 pueda
> evolucionar sin migración.

### `materiaPrima`
`codigoInterno` (3, 31, B1, P11…), `nombre`, `tipo` (VIRGEN / MASTER / MOLIENDA / SOBRANTE /
MUESTRA), `proveedor`, mínimos. Los tipos MOLIENDA y SOBRANTE no son categorías sueltas: son el
resultado de las transformaciones de §3.5.

## 3. Stock — el núcleo

**Decisión estructural**: el stock es un **ledger**. `movimiento` es la verdad; `saldo` es caché
reconciliable. Nunca se escribe un saldo sin su movimiento, y van en la misma transacción.

### `deposito`
NEXA y CPS (§3.4). En R1 sólo NEXA está activo, pero la columna existe en todo movimiento desde
la primera migración.

### `movimiento`
La tabla más importante del sistema. Una fila por hecho físico.

| Columna | Para qué |
|---|---|
| `tipo` | ENTRADA · SALIDA · AJUSTE · TRANSFERENCIA · TRANSFORMACION |
| `depositoId` | §3.4 |
| `productoId` / `materiaPrimaId` | Uno de los dos, nunca ambos |
| `loteMpId` / `partidaId` | El lote o partida concreta que se movió — la trazabilidad de §3.3 |
| `cantidad` | Siempre en unidad canónica (§7.1.3) |
| `origenTipo` / `origenId` | Qué lo causó: un ciclo, un pedido, un inventario, una transformación |
| `contrapartidaId` | Autorreferencia: une las dos patas de una transformación o transferencia |
| `usuarioId` / `creadoEn` | Auditoría (§7.1.2) |

`contrapartidaId` es lo que hace que sobrantes y moliendas (§3.5) sean **transformaciones** y no
ajustes sueltos: la salida de 10 kg de Copolímero 2240P y la entrada de 10 kg de "402-sobrante
Copolímero 2630p" quedan unidas, y se puede responder de dónde salió cada kilo.

### `saldo`
`(depositoId, productoId|materiaPrimaId)` → `cantidad`. Derivable por completo de `movimiento`;
existe sólo por performance. Un job de reconciliación lo compara contra la suma del ledger.

### `reserva`
Lo que arregla el bug que el cliente detectó (§5.4). Cuando se carga un pedido, cada línea
**reserva** stock disponible; el resto queda como faltante a producir.

    disponible = saldo − reservas abiertas

Así dos pedidos del mismo producto no pueden decir ambos "OK para armar". Se libera al armar (se
convierte en salida real) o al cancelar el pedido.

### `inventarioFisico` + `inventarioLinea`
El recuento de los viernes (§3.6). Cabecera con fecha, depósito, responsable y estado; líneas con
contado vs sistema, diferencia y motivo. Al cerrarlo genera los movimientos de AJUSTE
correspondientes, cada uno apuntando al inventario que lo originó.

## 4. Materia prima y trazabilidad

### `certificadoCalidad`
`numeroCorrelativo` (asignado por orden de llegada, §3.3), proveedor, material, fecha, y el PDF
escaneado en Vercel Blob. Es la raíz de la cadena de trazabilidad.

### `loteMp`
El lote del proveedor. `numeroLote` (los 12 dígitos del bloque 4, §3.2), `certificadoId`,
`materiaPrimaId`, `codigoBarra` completo, fecha de ingreso, cantidad. **Es lo que se etiqueta y
se piquea**, no la materia prima genérica.

El parseo del código de barras valida los largos fijos de §3.2. Los que no cumplen se rechazan
con el motivo, en vez de guardarse mal.

### `retiroMp`
El retiro diario a tolva (§3.12), con su formulario FN°10/2: fecha, lote, peso, inyectora,
responsable que retira, responsable de MP que entrega. Genera la salida de stock y es lo que
vincula el lote con el ciclo de producción.

## 5. Producción

### `partida`
El N° de partida NEXA. **Generado por el sistema**, no tipeado (pregunta 11). Se abre al iniciar
un ciclo y agrupa todo lo inyectado con la misma combinación de material y color.

### `cicloProduccion`
Inicio y fin separados, como pidió Ignacio. Inicio: fecha, inyectora, producto, operario, hora,
golpes al inicio, y los valores que el sistema **precarga desde el producto** (piezas por golpe,
ciclo, modo, receta). Fin: hora, golpes finales, piezas producidas (calculadas), descartadas,
entregadas a stock, colada, rebarba, scrap.

`piezasEntregadas` genera la entrada a stock, atada a la partida.

### `cicloMateriaPrima`
Qué lotes concretos se consumieron en el ciclo, con su peso. Es el eslabón lote ↔ partida de
§3.3. Permite responder el caso de Eduardo: dado un N° de partida, qué lotes se usaron, y dado
un lote defectuoso, qué partidas y qué cajas salieron de él (§3.11).

### `caja`
La caja física etiquetada. `partidaId`, `productoId`, `numeroCaja`, `cantidad`, `codigoBarra`,
estado (EN_STOCK / ARMADA / DESPACHADA). **No existía en el mockup**, y sin ella no se puede
contestar "esta caja, ¿de qué partida salió?" ni sacar de circulación las partidas de un lote
fallado.

Resuelve además el bug de §5.9: la cantidad la trae la caja, no un default de 25.

## 6. Ventas y despacho

### `cliente`
`nombre`, CUIT, condición de IVA, domicilios (varios), contactos. Hoy son ~360 (pregunta 10).

### `pedido`
`numeroOrden`, cliente, fecha, prioridad, datos comerciales (total, seña, resta, método de pago,
comprobante), entrega (modo, domicilio, requiere colocación).

El estado **no es un enum lineal**: es `estado` + el avance real de las líneas, porque el cliente
pidió **despacho parcial** ("retira los pisos hoy, las rampas la semana que viene"). Un pedido
puede estar parcialmente despachado y seguir abierto.

### `pedidoLinea`
Producto, cantidad pedida, reservada, armada, despachada. La línea es la unidad de avance.

### `despacho` + `despachoLinea`
**Un pedido puede tener N despachos.** Cada uno con su fecha, remito, transporte y quién lo
controló. Esto es lo que habilita el despacho parcial y los remitos múltiples.

### `piqueo`
Cada lectura de código de barras queda registrada: quién, cuándo, qué caja, en qué control. El
cliente pidió **dos piqueos** — uno al pasar de armado a despacho (control de armado) y otro en
el control final (control de entrega) — *"y que dichos piqueos queden registrados para garantizar
los movimientos"*. Por eso es tabla, no un contador en la línea.

### `devolucion`
El circuito de §3.11: motivo (dirección equivocada / mercadería equivocada / fallada /
defectuosa), pedido y líneas afectadas, resolución, y la derivación obligatoria al supervisor.
Si es material defectuoso, dispara la búsqueda de partidas del mismo lote en stock.

## 7. Qué entra en cada release

| Tabla | R1 | R2 | R3 | R4 | R5 | R6 |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| `usuario`, `sesion` | ✅ | | | | | |
| `proveedorMaster`, `color`, `producto` | ✅ | | | | | |
| `cliente`, `pedido`, `pedidoLinea` | ✅ | | | | | |
| `deposito`, `movimiento`, `saldo`, `reserva` | ✅ | | | | | |
| `materiaPrima` | ✅ | | | | | |
| `inventarioFisico` | | ✅ | | | | |
| `partida`, `cicloProduccion` | | | ✅ | | | |
| `recetaProducto` (estructura en R1) | | | | ✅ | | |
| `certificadoCalidad`, `loteMp`, `retiroMp`, `cicloMateriaPrima` | | | | ✅ | | |
| `caja` | | | ✅ | | | |
| `despacho`, `despachoLinea`, `piqueo` | | | | | ✅ | |
| `devolucion` | | | | | ✅ | |

Las tablas estructurales de R1 (`movimiento` con `depositoId`, `contrapartidaId`, `loteMpId` y
`usuarioId`) nacen con todas sus columnas aunque sus consumidores lleguen en R3–R5. Columnas
nullable hoy, obligatorias cuando su release las llena.
