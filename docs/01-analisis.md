# NEXA — Análisis y decisiones de arquitectura

> Fuentes: `Procedimientos Nexa.docx` (25.000 caracteres, procedimiento firmado por todo el
> personal), `transcripcion 3er visita a CPS.docx` (626 líneas, reunión de Ignacio con Eduardo
> González del 16/09/2026), `1er informe de Desarrollo de proyecto` (8 pág.), los `.xlsx` del
> cliente en `/data`, y el código del mockup previo (`github.com/nachovenutolo-dev/nexa`).
> Originales en `/data` y `docs/entregables/`.

## 1. El negocio en cinco líneas

**Conexiones Plásticas Sudamericana SRL** (CPS) es una inyectora de plástico de San Martín.
**NEXA** es su unidad de pisos plásticos modulares encastrables — línea nueva, creciendo rápido
y **sin stock**: *"la verdad que está moviendo bastante, no estamos haciendo tiempo de hacer el
stock"* (Eduardo, reunión del 16/09). La otra mitad de la fábrica inyecta componentes para
terceros (AISA, válvulas) y **no entra en este sistema**.

**Esto no es un ERP de proyecto de ciclo largo como REINER: es un sistema de alto volumen
transaccional con trazabilidad obligatoria por lote.** Esa frase debe gobernar cada decisión de
diseño.

## 2. El problema raíz

CPS no tiene un problema de información: tiene la información **fragmentada en Excel que no se
hablan entre sí**, y cada empalme entre dos Excel es un lugar donde el dato se pierde.

El caso testigo lo contó Eduardo textual:

> *"la chica de materia prima, como no tenemos contacto directo entre producción y cosas, si son
> Excel diferentes, ella toma lo que él saca, viene y lo carga. Pero en realidad tendría que
> figurar como decís vos: ella lo que tenía que hacer es un control de que lo que salió está
> cargado."*

Es decir: **hoy alguien re-tipea a mano el movimiento que otro sector ya registró**, y su trabajo
real (controlar) se convierte en trabajo de data entry. Lo mismo pasa entre ventas y producción,
entre producción y stock, y entre stock y despacho.

→ **El valor del sistema no está en ninguna pantalla en particular, sino en que el dato se cargue
una sola vez, donde ocurre el hecho físico.** Toda pantalla que obligue a re-tipear algo que el
sistema ya sabe está mal diseñada.

## 3. Hallazgos del análisis de los documentos

Lo que sigue **no está en el informe previo** y sale de leer el procedimiento firmado y la
transcripción completa. Cambia el modelo de datos.

### 3.1 La regla de codificación de producto es explícita y estructurada

El procedimiento la define sin ambigüedad:

> *"Esta contará con un número identificatorio del producto, seguido de la inicial del proveedor
> del master (color), la codificación preestablecida del producto inyectado, ejemplo piso rejilla
> (PR), y por último las iniciales del color."*

    001B-PR-NE   →  001 = producto · B = Berma (proveedor del master) · PR = piso rejilla · NE = negro

El motivo de incluir al proveedor del master es de negocio, no cosmético: *"dada la diferencia de
brillos y tonos de color entre los distintos proveedores"*. **Dos productos con el mismo color
nominal pero distinto proveedor de master son SKUs distintos y no son intercambiables.**

Consecuencia de diseño: el código no es un string opaco, son **cuatro componentes** (número,
proveedor de master, tipo de producto, color). Derivar el código de sus partes — y no al revés —
elimina de raíz el problema de los colores escritos de tres formas distintas.

### 3.2 El código de barras de materia prima tiene largo fijo por bloque

También definido en el procedimiento, con cantidad de dígitos exacta:

| Bloque | Dígitos | Qué es |
|---|---|---|
| 1 | 3 | Producto inyectado (identifica producto y color) |
| 2 | 4 | Materia prima (código interno NEXA) |
| 3 | 8 | Codificación del nombre del proveedor + **número de certificado de calidad** |
| 4 | 12 | **Número de lote o partida de la materia prima** (del certificado de calidad) |

El mockup lo parseaba como "4 bloques separados por guión" y fallaba en 10 de 115 códigos. Con
los largos fijos se puede parsear y **validar**, y los que no cumplen se marcan como error de
carga en vez de guardarse silenciosamente mal.

### 3.3 El certificado de calidad es una entidad, no un campo

> *"deberá solicitar al proveedor el certificado de calidad del producto, el cual numerará
> correlativamente según orden de llegada (este número servirá para el rastreo inequívoco del
> certificado)"*

Y el motivo por el que toda la cadena de trazabilidad existe, dicho por Eduardo en la reunión:

> *"Yo rastreo por el número 80 y me tendría que sacar todas las producciones que tiene el 80…
> porque con ese lote yo tengo el certificado de calidad de la materia prima. Claro, porque si no,
> perdemos responsabilidad."*

**La trazabilidad no es una feature: es cobertura de responsabilidad legal ante un reclamo.** La
cadena completa que el sistema tiene que poder recorrer en los dos sentidos es:

    Certificado de calidad → Lote de MP → Ingreso de MP → Retiro a tolva → Ciclo de inyección
      → Partida NEXA → Caja etiquetada → Pedido → Cliente

Hoy esa cadena se corta en tres lugares: la partida se tipea a mano, el lote de MP vive como
string, y la caja no existe como entidad.

### 3.4 El stock de NEXA es independiente del de CPS, con transferencias

> *"El stock de NEXA será independiente del de CPS, pero podrán compartir materiales si la
> urgencia lo requiriere, a modo de transferencias de mercadería entre Stock."*

Consecuencia: **el stock necesita dimensión de depósito desde el día 1**, aunque en R1 haya un
solo depósito activo. Agregarlo después obliga a reescribir todos los movimientos.

### 3.5 Sobrantes y moliendas son transformaciones de material, no ajustes

Dos circuitos que el mockup no modela y que explican el concepto confuso de "producto sin asignar":

**Sobrantes** — *"todo material virgen extraído de inyectora o sobrantes de bolsas solicitadas
desde máquina, el cual, aunque siga conservando su estado, pasará a tener otro número dentro del
Stock"*. Eduardo lo explicó en la reunión: la tolva se carga por bolsa completa de 25 kg, y si
sobran 10 kg **eso pasa a ser otro material**. Lo que salió, salió: no vuelve al código de origen.

**Moliendas** — coladas y piezas de descarte se muelen los miércoles, se pesan, se embalan en
canastos numerados correlativamente **por material y por día**, y reingresan al stock como
material nuevo de primera o segunda calidad.

Consecuencia de diseño: son **movimientos de transformación** (sale material A, entra material B,
vinculados), no entradas y salidas sueltas. Si se modelan como ajustes, el inventario cierra pero
se pierde de dónde salió cada kilo — y con él la trazabilidad de 3.3.

### 3.6 El recuento físico de los viernes es parte del sistema

> *"Los días viernes a última hora, sin excepción, se realizará un recuento físico… Este recuento
> será volcado al sistema el mismo viernes a última hora para que gerencia tenga la información
> actualizada. De detectarse diferencias, se informarán a supervisor a fin de identificar/corregir
> causas y generar los ajustes correspondientes."*

No es "corrección manual de stock" como la implementó el mockup: es un **evento de inventario
recurrente**, con fecha, responsable, diferencias por material y motivo. Gerencia lo mira.

### 3.7 Hay dos etiquetas distintas, con dueños distintos

Eduardo lo aclaró al principio de la reunión: *"etiqueta en realidad manejamos dos"*.

| Etiqueta | Cuándo | Qué lleva | Quién la genera |
|---|---|---|---|
| **De producto** | En boca de inyectora, al cerrar la caja | Producto, código, cantidad, fecha, N° de partida, código de barras | Operario de inyección |
| **De despacho / cliente** | Al armar el pedido | Nombre o empresa del comprador, fecha de despacho, dirección, transporte | Encargado, al bajar de stock |

La de producto es la que sostiene la trazabilidad; la de despacho es la que evita el error de
entrega. El mockup sólo implementó la primera. Eduardo pidió explícitamente que la segunda sea
automática *"para que ellos no metan la pata en algún dato"*.

### 3.8 La planificación de compra de MP ya existe, en un Excel que Eduardo mantiene a mano

Es lo que más le duele y lo que más valor tiene. Su fórmula, reconstruida de la reunión:

    Necesidad de compra =
        pedidos pendientes de inyectar
      + stock mínimo de pisos
      + stock mínimo de materia prima
      − stock actual de MP
      − compras en proceso (ya pedidas, no entregadas)

Horizonte **semanal**, no mensual: *"es semanal porque incluso en pisos es mucha la cantidad que
se usa de materia prima"*. Consumo de referencia: **1.750 kg/semana** con la inyectora 8 hs
diarias.

Los datos para calcularlo ya los tenemos (§3.9). Es el release 6.

### 3.9 Las recetas de material están completas en `Calculo por metro.xlsx`

| Dato | Valor |
|---|---|
| m² por baldosa | 0,16 → **6,25 baldosas/m²** |
| Peso baldosa | 0,610 kg → **3,8125 kg/m²** |
| Unidades por caja | **Rejilla 8** · **Ciego 25** |
| Piezas por golpe | piso **1** · rampa **2** · ángulo **4** |
| Receta Rejilla | 100 % Copolímero 2240P |
| Receta Ciego | 50 % Copolímero 2630PC + 50 % Plastomer |
| Master | 0,015 kg por kg de MP |
| Peso caja rejilla armada | 5,345 kg · piso moneda 15,42 kg · piso trama 14,985 kg |

Con esto, elegir producto + cantidad permite al sistema calcular solo la MP necesaria — que es
exactamente lo que Eduardo pidió: *"sería bueno que todo lo que se pueda tener precargado esté"*.

⚠️ **Contradicción a resolver antes de R4:** el Excel dice 0,015 kg de master por kg de MP
(150 g cada 10 kg). En la reunión Eduardo dijo *"creo que son 150 gramos cada 25 kilos"* (= 0,006).
**Son 2,5× distintos.** Ver §6, pregunta 4.

### 3.10 El organigrama real tiene 8 roles y 12 personas con nombre

Del procedimiento firmado:

| Rol | Personas |
|---|---|
| Supervisor general | Eduardo González |
| Administración y ventas | Alejandra Antón |
| Encargado (coordinación de producción y despacho) | David Orellano |
| Materia prima | Daniela Tenorio, Sabrina Orellano (reemplazo: Ariel Orellano) |
| Retiros de MP e informes de producción | Dylan Romero (reemplazo: Franco Uribarri) |
| Matrices y mantenimiento | Alejandro Rivero, Cristian Troncoso |
| Molino | Yesica Troncoso |
| Despacho y control final | Sabrina Orellano, Adriana Troncoso |

Más **Gerencia** (los dueños) y los **operarios de inyección**, en dos turnos.

Esto reemplaza los 5 roles inventados del mockup. Y la matriz de permisos ya está definida por
el cliente en la reunión: *"el encargado de pisos tiene que ver todo menos precios… supervisor
soy yo, también todo menos precios… y de supervisor para arriba, ventas y gerencia, ellos pueden
ver todo"*. La encargada de MP ve sólo su sector.

### 3.11 Hay un circuito de devoluciones que el mockup no contempla

El procedimiento lo detalla en 4 casos (dirección equivocada, mercadería equivocada, mercadería
fallada, material defectuoso) y obliga a que **toda devolución pase por el supervisor general**.
El caso grave: si se detecta material defectuoso, hay que **identificar si hay partidas de ese
lote en stock para sacarlas de circulación**. Eso sólo es posible con §3.3 resuelto.

### 3.12 Restricción operativa: un solo retiro de MP por día

> *"se pacta un solo retiro diario, siendo responsabilidad del sector de inyectado la correcta
> planificación del mismo para abastecer la jornada completa"*

Es una restricción de planificación real: la orden de producción del día tiene que consolidar
todo el material de la jornada en un solo pedido a MP. Condiciona cómo se arma la pantalla de
retiro en R4.

## 4. Lo que el mockup resolvió bien (se conserva como especificación)

El repo de Ignacio no se continúa como código, pero es un **documento de requerimientos validado
en tres reuniones**. Se reusa:

- El modelo de dominio general, bien intuido.
- El ciclo de producción partido en **inicio / fin** (pedido explícito de Ignacio en la reunión).
- La **cola de producción que suma faltantes de varios pedidos** — Eduardo: *"genial, está
  arregladito, justo lo que te había preguntado"*.
- El **piqueo con lector de código de barras** y el feedback en vivo completo/falta/sobra.
- El semáforo de stock, la prioridad manual de pedidos, el generador de etiquetas Code 128.
- Las pantallas como guía de UX: el cliente ya las vio y las validó.

## 5. Por qué se refunda el núcleo

Diez hallazgos del código del mockup, ordenados por riesgo. El detalle largo está en el análisis
entregado a Matías el 24/09; el resumen operativo:

| # | Problema | Consecuencia |
|---|---|---|
| 1 | Sin autenticación: el rol vive en `localStorage`, las URLs no están protegidas | Cualquier operario ve precios |
| 2 | Sin migraciones; `npm run seed` **borra todo y recarga** desde los Excel | Pérdida total de datos reales el día que alguien lo corra |
| 3 | Dos fuentes de verdad para el stock (`cantidadActual` + tabla de movimientos) sin reconciliación, y el piqueo las escribe en transacciones separadas | Stock que deriva del físico sin forma de auditar por qué |
| 4 | Sin reservas: "material comprometido" se calcula al vuelo | Dos pedidos del mismo producto dicen ambos "OK para armar" habiendo stock para uno (el cliente lo detectó) |
| 5 | Materia prima desconectada; cantidades como texto libre (`"50 Kg"`, `"800 Gr"`) | Producir no descuenta MP. §3.8 es imposible |
| 6 | Partida tipeada a mano, lote de MP como string, caja inexistente | La cadena de §3.3 se corta |
| 7 | Estados de pedido como enum lineal | Sin despacho parcial, sin doble piqueo, sin remitos |
| 8 | Ningún movimiento registra quién lo hizo | Sin auditoría, con turnos rotativos |
| 9 | Unidades mezcladas (baldosas / m² / cajas / kg) sin unidad canónica | La etiqueta asume 25 u/caja cuando la de rejilla es de 8 → **descuenta mal el stock al piquear** |
| 10 | Lógica de dominio dentro de los server actions (568 líneas), sin validación ni tests | Cada regla nueva cuesta más que la anterior |

Los cuatro primeros son decisiones de **modelo de datos**, no de código: parcharlos sobre el
esquema actual cuesta más que rehacerlo con el dominio ya entendido.

## 6. Preguntas abiertas para el cliente

Ordenadas por cuánto frenan. Las que bloquean R1 van primero.

| # | Pregunta | Para | Bloquea |
|---|---|---|---|
| 1 | Los valores de la columna MÍNIMO (500, 1500), ¿son el mínimo real o el objetivo de stock? Hoy dejan **70 de 94 productos en rojo**, con lo cual el semáforo no informa nada. ¿Cuál es el mínimo y cuál el máximo de cada producto? | Eduardo / David | R2 |
| 2 | ¿Cuál es la **lista oficial de colores** de NEXA con su nombre exacto y sus dos iniciales (§3.1)? En los Excel el mismo color aparece escrito de hasta tres formas. | Eduardo | R1 |
| 3 | En los pedidos el color viene como texto libre y muchas veces **multicolor en una sola celda** ("Gris oscuro y amarillo"). ¿Eso es una línea de pedido con varios productos, o un producto especial? De 100 líneas importadas sólo 22 se pudieron vincular a un SKU. | Alejandra | R1 |
| 4 | **Master por kg**: el Excel dice 0,015 kg/kg (150 g cada 10 kg); en la reunión se dijo "150 g cada 25 kg" (0,006). ¿Cuál es? | Eduardo / Alejandro (matrices) | R4 |
| 5 | ¿Las unidades por caja son siempre Rejilla 8 / Ciego 25, o varía por producto? El catálogo no las tiene cargadas. | David | R1 |
| 6 | ¿Las vendedoras cargan el pedido directo en el sistema, o seguimos importando su Excel? Ignacio quedó en averiguar si ese Excel se alimenta solo desde otro programa. **Es el pendiente explícito de la minuta.** | Alejandra | R1 |
| 7 | ¿Alguien de CPS cargó datos reales en el prototipo desde el 15/09, o sigue siendo todo el snapshot de los Excel? Define si hay algo que migrar. | Ignacio | R1 |
| 8 | ¿Hace falta que el pedido esté cobrado antes de despachar? Hoy la facturación va por un sistema aparte. | Alejandra / Gerencia | R5 |
| 9 | El histórico usa inyectoras 6 y 8, pero NEXA tendría una sola. ¿Cuál es? ¿Puede cambiar? | David | R3 |
| 10 | La base real de clientes son ~360 y la hoja CLIENTES está vacía. ¿De dónde se exporta? ¿Con CUIT y condición de IVA? | Alejandra | R1 |
| 11 | ¿El N° de partida NEXA lo sigue asignando una persona o lo genera el sistema? Eduardo se inclinó por automático: *"si fuera automático, que cada vez que yo cambio de…"*. | Eduardo | R3 |
| 12 | Los 3 primeros dígitos del código de barras de MP identifican "producto inyectado" (§3.2). ¿Qué pasa cuando una misma bolsa se usa para varios productos? | Daniela / Eduardo | R4 |

## 7. Arquitectura

| Pieza | Decisión |
|---|---|
| App | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind v4 |
| Base | **Postgres en Neon**, vía la integración de Storage de Vercel |
| ORM | Drizzle, con **migraciones versionadas** (`db:generate` + `db:migrate`) desde el día 1 |
| Auth | Sesión propia firmada con `jose`, igual que REINER. Email+contraseña para administración; **PIN para operarios de planta** |
| Archivos | Vercel Blob — certificados de calidad (R4), remitos firmados (R5) |
| Hosting | Vercel, cuenta `matiasvenutolo-cmd`, con **dominio propio** (no el subdominio autogenerado) |
| Importación | `scripts/import-excel.ts` — **idempotente por clave natural, nunca destructivo** |

### 7.1 Decisiones no negociables del núcleo

1. **El ledger de movimientos es la fuente de verdad del stock.** Ningún saldo se escribe sin su
   movimiento, y ambos van en la misma transacción. El saldo es caché reconciliable, no verdad.
2. **Toda mutación registra quién y cuándo.** Sin excepción.
3. **Unidad canónica = la unidad física** (baldosa, pieza, kg). m², cajas y bolsas son
   *presentaciones* derivadas, nunca se guardan como cantidad.
4. **El stock tiene depósito** desde la primera migración (§3.4), aunque haya uno solo activo.
5. **El código de producto se deriva de sus componentes** (§3.1), nunca se tipea.
6. **Vocabulario del cliente en toda la UI**: partida, piqueo, colada, rebarba, molienda,
   sobrante, master, golpe, inyectora, baldosa. El procedimiento firmado es el glosario.
7. **Nada de lógica de dominio en los server actions**: van en `src/lib/data/`, con la action
   como capa fina de validación (zod) + autorización.

## 8. Costos

Igual que REINER: durante el desarrollo corre en la cuenta de Pinaro sobre tiers gratuitos
(Vercel Hobby + Neon free + Blob free). El traspaso a la cuenta de CPS se documenta en
`docs/04-runbook-traspaso.md` y se ejecuta antes de la puesta en marcha real en planta.

El dominio propio es el único costo fijo desde el día 1.
