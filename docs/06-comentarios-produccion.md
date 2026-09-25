# Comentarios del cliente sobre el circuito de Pedidos → Producción

> Fuente: audio + texto de Ignacio del 26/09/2026, relayendo comentarios del cliente sobre
> **el sistema viejo** (el mockup de `nachovenutolo-dev/nexa`, no el que estamos construyendo).
> Import ante: varios de estos puntos ya están resueltos en el sistema nuevo — se marca cada uno.

## 0. Contexto

Ignacio le mostró el mockup viejo al cliente y el cliente mandó una lista de mejoras. La mayoría
apunta a lo mismo: **"todo lo que el pedido dispara para producción"** es el problema real que hoy
tiene la empresa. Ignacio sugiere no entregar todo de a poco sino seguir armando con la producción
ya incluida en el alcance, porque las mejoras que pide el cliente salen de ver la relación completa
entre pedidos y producción — no de ver los pedidos solos.

Esto no cambia lo ya decidido (R1 = Pedidos, ya entregado) — es información para planificar R2 en
adelante, y una pregunta de secuencia que le devuelvo a Matías en el chat.

## 1. Ya resuelto en el sistema nuevo

| Pedido del cliente | Estado |
|---|---|
| "Por favor quitar la vista de precios al encargado" | ✅ Ya así. `puedeVerPrecios()` (`src/lib/auth/permisos.ts`) excluye a ENCARGADO desde el primer commit de R1 — sólo Gerencia y Administración ven precios. Probado en el navegador con la sesión de David Orellano. |
| "Carga directa en el sistema, no Excel" | ✅ Ya así. Es como está construido `/pedidos/nuevo` desde R1. |

## 2. El schema ya lo soporta (falta cargarlo, no rediseñarlo)

| Pedido del cliente | Por qué ya está cubierto |
|---|---|
| "El pedido de material debería permitir hasta 3 tipos distintos" (el piso ciego lleva 2 materiales y a veces se intercala molienda de alguno) | `recetaProducto` (docs/02-modelo-datos.md §2) es una tabla de **N componentes por producto**, no está limitada a 2. El "2" que aparece en el análisis es el dato real de hoy (Rejilla 1, Ciego 2), no un techo del modelo. Falta R4 para cargarlo y usarlo, no hay que tocar el esquema. |
| "Mostrar material comprometido para pedidos y cantidad a comprar reponiendo mínimos, contemplando lo que falta producir" | Es la fórmula de §3.8 de `01-analisis.md` (la planificación semanal de Eduardo), ya diseñada para R6. Este comentario la confirma tal cual, no agrega nada nuevo. |
| "MP que descuente con la entrega a máquina, por código de barras o carga manual" | Es `retiroMp` + `loteMp` de R4 (docs/02-modelo-datos.md §4), ya diseñado así. |

## 3. Nuevo: obliga a ajustar el modelo antes de construir R3

### 3.1 Un ciclo de producción tiene que poder cubrir VARIOS pedidos, no uno

> "En pedido asociado tendría que desplegar la lista de todos los pedidos a inyectar que contengan
> ese producto, para poder seleccionar los correspondientes a esa selección de inyección según
> urgencias y generar la suma total a inyectar."
>
> "Producción, pedido asociado debería poderse asociar varios de ellos, seleccionando prioridades
> de inyección."

El schema actual (`cicloProduccion.pedidoId`, un solo FK nullable) sólo permite atar un ciclo a **un**
pedido. Lo que pide el cliente es lo que la cola de producción del mockup ya hacía a medias (sumar
faltantes de varios pedidos) pero llevado al ciclo real: elegir qué pedidos cubre una tirada de
inyección, entre varios que piden el mismo producto, por prioridad.

**Ajuste necesario en R3**: reemplazar el FK simple por una tabla intermedia (`ciclo_pedido`,
N:M) con la cantidad de ese ciclo que se asigna a cada pedido. Se anota acá para no rehacerlo
cuando se construya R3 — no bloquea nada de R1/R2.

### 3.2 ¿Producción se carga por ciclo libre o por día? — vuelve a estar abierto

> "La colada, piezas producidas, piezas descartadas deberían cargarse diariamente junto con el
> material. Día por día, pues son indicadores diarios."
> "Que al finalizar el día indique cuánto material consumió y lo reste al colocado."

Esto **contradice, o al menos tensiona**, una decisión que Ignacio ya había tomado en la reunión
del 16/09 (`transcripcion 3er visita a CPS.docx`): ahí él prefirió expresamente que el ciclo se
pueda cargar libre — inicio y fin sin atarlo a un corte de día, porque "podrías cargar el fin dos
días después y podrías haber estado produciendo 3 días" — y Eduardo dudaba entre las dos opciones
sin cerrarla.

Ahora el cliente pide explícitamente indicadores **por día**. No lo resuelvo por mi cuenta: queda
como pregunta abierta para R3, no como asunción. Ver pregunta nueva más abajo.

## 4. Confirma el alcance ya previsto — sin cambios de diseño

| Pedido del cliente | Release |
|---|---|
| Cantidad a inyectar para cubrir pedidos y mínimos, detallada, para que el encargado priorice | R3 (cola de producción) + R6 (mínimos) |
| Etiqueta de cliente autogenerada con los datos del pedido (nombre, domicilio, forma de entrega) | R5 |
| Diferencia a inyectar entre mínimos y máximos en la pantalla de stock de productos | R2 |
| Evaluar carga de MP habilitada todos los días, no sólo al cierre | R4 |
| Fórmula que compare material/master utilizado contra material/master inyectado | R4 — mismo tema que la pregunta 4 de `01-analisis.md` (la contradicción del 0,015 vs 0,006) |

## 5. Candidato para hacer ya — pendiente decisión

> "Que en la sección Pedidos se pueda crear un nuevo producto asignando código y un nuevo color
> (a veces hacen colores a medida)."

Hoy el formulario de carga de pedido, cuando el color no está en catálogo, guarda la línea como
"sin producto asignado" con el color a mano (nunca inventa un SKU — ver README de R1). Lo que pide
el cliente es un paso más: que desde ahí mismo se pueda **dar de alta el producto nuevo** (código +
color), resolviendo el SKU en el momento en vez de dejarlo pendiente.

Es un agregado chico sobre lo que ya existe, no toca el modelo de datos. Lo dejo para que Matías
decida si entra ahora o se prioriza con el resto — ver la pregunta en el chat.

## 6. Preferencia de navegación (sin acción por ahora)

> "Siempre es más cómodo el menú al costado, quizás dividir en Pedidos y Producción, cada uno con
> sus sub-rubros."

Anotado para cuando exista Producción (R3): hoy el menú de NEXA es horizontal y con un solo nivel
porque sólo hay tres módulos construidos (regla 7 de `03-plan-release-1.md` — no armar una
estructura de menú para secciones que todavía no existen). Cuando entre Producción con sus propias
subpantallas, se revisa si conviene pasar a un menú lateral con sub-rubros.

## 7. Nueva pregunta para la próxima reunión

| # | Pregunta | Para |
|---|---|---|
| 13 | La carga de producción, ¿tiene que ser por día (como pide el cliente ahora) o libre por ciclo de inyección (como se decidió en la reunión del 16/09)? Son dos diseños distintos y no se pueden mezclar a medias. | Eduardo |
