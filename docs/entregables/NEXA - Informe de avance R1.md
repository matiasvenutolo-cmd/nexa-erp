# NEXA — Informe de Fase 1

**Núcleo + Pedidos** · Septiembre 2026

---

## Resumen

Arrancamos la construcción del sistema definitivo de NEXA, reemplazando el prototipo anterior por
una aplicación real, con base de datos propia y ya cargada con la información real de la empresa:
el catálogo completo, la materia prima, los clientes y los pedidos de los últimos meses.

Esta primera entrega cubre lo que se definió como prioridad: **el circuito de pedidos**, de punta a
punta. Ya se puede usar para cargar un pedido nuevo, con las mismas reglas que hoy resuelven a
mano.

No es un mockup para mirar: es el sistema real, con los datos reales. Lo que se carga desde acá
queda guardado.

## Cómo entrar

**https://nexa-erp-two.vercel.app**

| Persona | Usuario | Contraseña |
|---|---|---|
| Eduardo González (Supervisor) | eduardo@nexa.com.ar | nexa2026 |
| Alejandra Antón (Administración) | alejandra@nexa.com.ar | nexa2026 |
| David Orellano (Encargado) | david@nexa.com.ar | nexa2026 |
| Daniela Tenorio (Materia prima) | daniela@nexa.com.ar | nexa2026 |

Son las mismas 8 personas del organigrama que ya está firmado en los procedimientos de la empresa.
La contraseña es provisoria — se cambia por una definitiva antes de que el sistema pase a
producción real.

Cada persona entra y ve sólo lo que le corresponde: quien no maneja precios, no los ve en ninguna
pantalla; quien no arma pedidos, no tiene el botón para cargar uno nuevo. Es exactamente la regla
que se definió en la reunión del 16/09.

## Qué se puede hacer hoy

### Cargar un pedido

Está en "+ Nuevo pedido". Se elige el cliente (o se carga uno nuevo ahí mismo), la fecha, y después
los ítems: para cada uno se elige el tipo de piso o accesorio y el color de una lista — así el
sistema siempre sabe exactamente qué producto es, sin ambigüedad. Al lado de cada color se ve el
stock que hay en ese momento.

Al guardar, el pedido queda visible al instante para todo el que lo necesite ver, con el chequeo de
si hay stock para armarlo o si falta producir.

**Colores a medida.** Cuando el pedido es de un color especial que no está en el catálogo, ahora se
puede dar de alta ahí mismo — se le asigna código automáticamente, con la misma regla que usa todo
el catálogo — en vez de dejarlo pendiente para cargar después a mano.

### Ver el estado de todos los pedidos

El listado de "Pedidos" trae los 65 pedidos reales de los últimos meses, ya importados desde el
Excel, con su estado (Pedido, Listo para despachar, Entregado, etc.) y filtros para encontrar
rápido los que están pendientes.

### Consultar el catálogo

En "Catálogo" está el listado completo de productos con el semáforo de stock: qué está bien, qué
está bajo mínimo. Ahí mismo se puede buscar por código o por nombre.

### Ver y cargar clientes

En "Clientes" está la base completa (los que ya compraron) y se puede dar de alta uno nuevo sin
salir del sistema.

## El problema que se resolvió

En el prototipo anterior había un caso que ustedes mismos habían detectado: si entraban dos
pedidos del mismo producto y no había stock para los dos, el sistema le decía "está listo para
armar" a **los dos pedidos a la vez** — aunque en la realidad sólo uno se podía cubrir.

Eso ya no puede pasar. Ahora, cuando se carga un pedido, el sistema **aparta** el stock para ese
pedido en el momento. El segundo pedido que pida lo mismo ya sabe que ese stock está comprometido
y avisa que hace falta producir, en vez de mentir que está todo bien.

Lo probamos a propósito: cargamos dos pedidos por el mismo color con poco stock, y el sistema
mostró correctamente uno como "OK para armar" y el otro como "Falta producir" — la diferencia
exacta que antes no existía.

## Cómo lo validamos

Antes de esta entrega recorrimos el sistema completo con cada uno de los cuatro roles, pantalla por
pantalla: quién ve qué, quién puede cargar qué, y qué pasa cuando algo sale mal (un pedido que no
existe, un cliente repetido, un pedido sin ítems). También lo probamos en celular, no sólo en
computadora, porque va a haber gente en planta usándolo así. Lo que encontramos en el camino se
corrigió antes de que ustedes lo vieran.

## Qué queda pendiente

Nada de esto bloquea el uso de lo que ya está. Lo que sigue abierto son las **definiciones que
quedaron pendientes de la reunión** (documento aparte, "NEXA — Definiciones pendientes"): la lista
oficial de colores y, sobre todo, los mínimos y máximos reales de cada producto — hoy el semáforo
de stock está calibrado con los valores del Excel viejo, y por eso casi todo aparece en rojo.

## Próxima etapa

Vamos a seguir directamente con **Stock y Producción juntos**: el registro de entradas y salidas
con historial, cuánto hay disponible versus comprometido versus a producir, y el circuito completo
de la inyectora — desde la cola de producción priorizada hasta la partida y la caja etiquetada.
Las mejoras que nos hicieron llegar sobre este circuito ya están incorporadas al alcance.
