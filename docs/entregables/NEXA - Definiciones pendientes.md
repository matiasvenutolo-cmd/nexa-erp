# NEXA — Definiciones pendientes

**Para la próxima visita a CPS** · Septiembre 2026

---

Arrancamos la construcción del sistema definitivo de NEXA. Para avanzar sin trabarnos ni tomar
decisiones por ustedes, necesitamos cerrar once definiciones.

Están agrupadas **por persona**, porque cada una la puede responder quien conoce ese sector.
Ninguna requiere preparación: son preguntas de cómo trabajan hoy.

Al final hay dos listas cortas: **qué asumimos mientras tanto** (para no frenar) y **qué archivos
necesitamos**.

Las que están marcadas 🔴 frenan la primera entrega. Las 🟡 se necesitan más adelante, pero si se
responden ahora nos ahorran rehacer trabajo.

---

## Eduardo González — Supervisor general

### 🔴 1. La lista oficial de colores

En los Excel el mismo color aparece escrito de varias formas: "Azul Oscuro", "azul oscuro",
"AZUL OSCURO"; "YUTE" y "Yute"; "Verde claro" y "Verde Claro". Para el sistema son colores
distintos, y eso rompe el catálogo.

El procedimiento dice que el código de producto lleva **las iniciales del color** (azul = AZ,
azul claro = AC, azul oscuro = AO).

> **¿Cuál es la lista oficial y definitiva de colores de NEXA, con el nombre exacto y las dos
> iniciales de cada uno?**

*Por qué importa:* el código de producto se arma solo a partir del color, el tipo y el proveedor
de master. Con la lista cerrada, nunca más hay un producto duplicado por una diferencia de
mayúsculas.

### 🟡 2. Cuánto master por kilo de materia prima

Acá tenemos dos números distintos y no sabemos cuál es el bueno:

- El Excel de cálculo dice **150 gramos cada 10 kilos** (0,015 kg por kg).
- En la reunión del 16/09 se mencionó **150 gramos cada 25 kilos** (0,006 kg por kg).

Son dos veces y media de diferencia.

> **¿Cuál de los dos es el correcto? ¿Y varía según el color?** (se mencionó que uno de los
> colores lleva un poco menos porque es más fuerte).

*Por qué importa:* de este número sale el cálculo automático de cuánto master comprar por semana.
Si está mal, el sistema pide de más o de menos.

### 🟡 3. El número de partida NEXA, ¿lo pone una persona o lo genera el sistema?

Hoy lo asigna a mano el encargado de producción, cuando cambia el material o la inyección. En la
reunión se planteó automatizarlo.

> **¿Puede el sistema generar el número de partida solo, cada vez que arranca una producción con
> una combinación nueva de material y color? ¿O hay casos en que tiene que poder forzarse a mano?**

*Por qué importa:* es la pieza central de la trazabilidad. Si se tipea a mano, tarde o temprano se
repite o se saltea un número, y se pierde el rastro.

---

## Alejandra Antón — Administración y ventas

### 🔴 4. ¿Cargar el pedido en el sistema o seguir con el Excel?

Es la definición más importante de esta primera etapa, y quedó pendiente de la reunión anterior.

> **¿El Excel de ventas que usan hoy lo llenan a mano, o se alimenta solo desde otro programa?**
>
> **Y si lo llenan a mano: ¿prefieren cargar el pedido directamente en el sistema nuevo, o que el
> sistema importe el Excel que ya generan?**

*Por qué importa:* si cargan directo en el sistema, el pedido chequea stock al instante y dispara
la producción solo. Si seguimos con el Excel, eso llega con demora y hay doble carga. Nuestra
recomendación es carga directa, pero la decisión es de ustedes y la respetamos.

### 🔴 5. Pedidos con varios colores en un mismo renglón

En el Excel de ventas es muy común ver el color como "Gris oscuro y amarillo" o "Negro, blanco y
rojo" en una sola celda, sin decir cuánto de cada uno. De 100 renglones que importamos, sólo 22
se pudieron vincular a un producto concreto.

> **Cuando un pedido lleva varios colores: ¿son varios renglones distintos (tantas baldosas de
> cada color), o es un producto combinado que se vende así?**
>
> **¿Y hay un caso de "color especial" fuera de catálogo?**

*Por qué importa:* si el sistema no sabe qué producto exacto lleva el pedido, no puede chequear
stock ni disparar la producción. Es el corazón del circuito.

### 🔴 6. La base de clientes

La hoja CLIENTES del Excel está vacía. Del Excel de ventas pudimos sacar unos 60 nombres, pero
entendemos que son alrededor de 360.

> **¿De dónde se exporta la base real de clientes? ¿Incluye CUIT, domicilio y condición de IVA?**

*Por qué importa:* sin eso hay que cargar cada cliente a mano la primera vez que compra, y no se
pueden emitir remitos con los datos correctos.

### 🟡 7. ¿Hace falta estar cobrado para despachar?

Hoy el Excel registra cuánto pagó el cliente, cuánto falta y la forma de pago, pero la facturación
va por un sistema aparte.

> **¿El sistema tiene que frenar un despacho si el pedido no está cobrado, o eso lo controla
> administración por fuera?**

---

## David Orellano — Encargado de producción

### 🔴 8. Los mínimos y máximos de cada producto

Este es el que más nos preocupa. En la hoja de stock, 90 de los 94 productos tienen cargada la
columna MÍNIMO (con valores como 200, 500, 1500) y **ninguno tiene cargado el MÁXIMO**.

Con esos números, **70 de los 94 productos le aparecen al sistema en rojo**. Un semáforo donde
casi todo está en rojo no sirve para decidir nada.

> **Esos valores (500, 1500), ¿son el mínimo que nunca hay que perforar, o son en realidad el
> objetivo de stock que quieren tener?**
>
> **¿Cuál sería el mínimo real y el máximo de cada producto?**

Entendemos que la línea es nueva y estos números se están calibrando. No hace falta que sean
definitivos: alcanza con un criterio (por ejemplo, "el mínimo es una semana de venta") y los
vamos ajustando.

### 🔴 9. Unidades por caja

El catálogo no tiene cargada la cantidad por caja. Del Excel de cálculo sacamos que la caja de
**Rejilla lleva 8** unidades y la de **Ciego lleva 25**.

> **¿Es siempre así, o varía según el producto? ¿Y los accesorios (bordes, esquineros, rampas)
> cómo se embalan?**

*Por qué importa:* la etiqueta de la caja lleva la cantidad, y esa cantidad es la que descuenta
del stock cuando se piquea. Si está mal, el stock queda mal.

### 🟡 10. La inyectora de NEXA

En el histórico de producción aparecen las inyectoras 6 y 8, pero entendemos que NEXA trabaja con
una sola.

> **¿Cuál es la inyectora de NEXA? ¿Puede cambiar según el producto o la matriz?**

---

## Daniela Tenorio — Materia prima

### 🟡 11. Los primeros dígitos del código de barras de materia prima

El procedimiento define el código de barras en cuatro bloques: 3 dígitos de producto inyectado,
4 de materia prima, 8 de proveedor y certificado, 12 de lote.

> **Los 3 primeros dígitos identifican el producto inyectado. Pero una misma bolsa de materia
> prima puede usarse para varios productos y colores distintos. ¿Cómo se resuelve eso hoy? ¿Se
> etiqueta la bolsa pensando en el producto al que está destinada?**

*Por qué importa:* queremos que el sistema valide el código al leerlo y avise si está mal armado,
en vez de guardarlo con un error silencioso.

---

## Qué asumimos mientras tanto

Para no frenar, tomamos estos criterios. **Todos son reversibles** y los cambiamos apenas nos
confirmen:

| Tema | Qué asumimos |
|---|---|
| Colores | La lista de 12 colores que figura en el Excel de cálculo, unificando mayúsculas |
| Pedidos multicolor | Se cargan como renglón "sin producto asignado", para completar a mano. **No inventamos un producto** |
| Unidades por caja | Rejilla 8 · Ciego 25 |
| Mínimos y máximos | Se importan tal cual están, pero el semáforo queda desactivado hasta tener los números reales |
| Clientes | Los ~60 del Excel de ventas; el resto se da de alta al usarse |
| Master por kg | 0,015 kg por kg (el valor del Excel), marcado como provisorio |

---

## Qué archivos necesitamos

| Archivo | Para qué |
|---|---|
| Exportación de la **base de clientes** completa | Cargar los ~360 clientes con sus datos reales |
| **Lista de colores** oficial con sus iniciales | Cerrar el catálogo de productos |
| Los **formularios en papel** que usan hoy: ingreso de MP (F.N°10P), retiro de MP (F.N°10/2) y planilla de despacho (F.N°12P) | Replicar en pantalla exactamente los datos que ya cargan, sin pedir nada de más |
| Un **remito en blanco** de los formularios preimpresos | Ustedes pidieron poder imprimir los remitos sobre sus formularios. Necesitamos las medidas exactas para que la impresión caiga en los casilleros |
| Un **certificado de calidad** de ejemplo | Ver qué datos trae y cómo se numera |
| Una **etiqueta de despacho** actual (foto alcanza) | Replicarla tal cual |
| Una **foto de stock actualizada**, si la hay posterior al 11/08 | Arrancar el sistema con el stock real del día del arranque |

---

## Lo que ya está resuelto

No hace falta discutirlo de nuevo, pero lo dejamos asentado:

- **Estados del pedido y despacho parcial.** Tomamos el pedido de poder despachar una parte
  (por ejemplo, que se lleven los pisos y queden las rampas para la semana siguiente). El pedido
  queda abierto con lo que falta.
- **Doble piqueo.** Se van a registrar los dos controles que pidieron: uno al pasar de armado a
  despacho, y otro en el control final. Queda registro de quién, cuándo y qué.
- **Aviso a ventas.** Cuando el pedido pasa a despacho, administración recibe el aviso.
- **Trazabilidad completa.** Desde el certificado de calidad del proveedor hasta la caja que
  recibió el cliente, en los dos sentidos: dado un reclamo, qué lote se usó; y dado un lote
  fallado, qué cajas salieron y a qué clientes.
- **Roles.** Se respetan los del procedimiento firmado, con la regla de que de supervisor para
  abajo nadie ve precios.
