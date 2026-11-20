# 22 · Reunión 20/11/2026 y notas de prueba del socio

Fuentes: transcripción de la reunión con David y Eduardo (20/11) y «Mejoras NEXA
20nov – lo que vi antes de la reunión» (con capturas). Commits 969c14e,
9f56430, 22fbf8a y el de este documento. Pruebas: `tests/reunion-20-11.test.ts`.

## Qué cambió

**Etiquetas**
- Aparecen al terminar la producción: «Terminar producción» pasa directo a
  imprimir las etiquetas de todas sus cajas. Ya no hay botón en el relevo.
- Menú Fábrica → **Etiquetas** (Encargado, Supervisión, Gerencia):
  producciones con cajas por fecha y producto o color; «Imprimir todas» o
  «Reimprimir algunas cajas» con motivo (queda en el historial).

**Pantalla del operario**
- Produciendo: primero el contador y «Terminar producción»; la carga va abajo
  («¿Cargaste la tolva otra vez?») y «Pedir material» deja de ser el botón
  grande.
- «Cargué distinto» está siempre, para cambiar cantidades en cada carga.
- Hasta **4 bolsas por carga** (sin contar el master), en pantalla y en el
  servidor.
- El material que sobró de la producción anterior ya no bloquea: si es de la
  receta de la tanda nueva, pasa a esa producción al arrancar; si no (ej.
  master de otro color), el mensaje dice qué es y que lo retira Materia prima.

**Llevar material a pie de máquina (Materia prima)**
- Lista «Para llevar a pie de máquina» (atrasadas, hoy, mañana, sin día):
  por tanda, lo que falta llevar en bolsas enteras para **toda la tanda**,
  descontando lo que ya está junto a la máquina.
- «Registrar que se llevó» precarga piezas y material. Campos: «Quién lo
  lleva a la máquina» (Dylan) y «Lo registra (Materia prima)» (Daniela).
- Registrado, vuelve a la lista: ya no manda a la pantalla de conciliación.
- El Encargado ya no tiene «Llevar material» en la tanda.
- Aviso en Materia prima cuando hay material para llevar hoy, y marca en
  Stock a pie de máquina para lo que quedó de una producción terminada.

**Materia prima ↔ Compras** (migración 0017: tipo de aviso «Compra de
materia prima»)
- «Pedir a Compras» en kg o en gramos. Corregido: la sugerencia con decimales
  («1.195») se leía como miles.
- Ingreso: primero «¿De qué compra es?»; de ahí salen material, proveedor y
  cantidad pendiente, y la compra pasa sola a entregada o parcial. Si el
  material tiene compras abiertas y el ingreso no es de ninguna, se pide el
  motivo.
- Avisos: Compras → Materia prima al ejecutar la compra y cuando cambia el
  estado o la fecha de llegada; Materia prima → Compras al registrar el
  ingreso. Materia prima tiene ahora «Avisos» en el menú.
- Compras: el total (o el precio por kg) se calcula a la vista.

**Producción y otras pantallas**
- Planificación: no se puede poner una tanda en un turno que el esquema del
  día no tiene (ej. noche en un día simple). En el calendario esos turnos se
  ven tachados y el encabezado muestra los horarios del esquema.
- El cambio de matriz se ve entre las dos tandas, justo antes de la que lo
  necesita.
- «Quitar los marcados» → «Sacar de esta tanda los pedidos tildados», con
  explicación.
- Relevos y novedades: número con los turnos que pasaron cajas a stock sin
  «Revisado / OK»; el botón sólo aparece en esos turnos. Las pausas muestran
  cuánto duraron.
- Pedidos: «Falta producir 118» dice de qué (ej. 70 Rejilla Rojo (008B)).
- Stock de productos: código como en la etiqueta (001B), nombre (Rejilla
  Amarillo) y el color.
- Pesos: desde 1 kg se muestran en kilos («1,875 kg», no «1.875 g»).

## Preguntas abiertas (responde: Gerencia CPS · Eduardo / David / Daniela)

1. **Material que sobra entre producciones** (Eduardo/David): si es de la
   receta de la tanda siguiente se usa en ella; si no, lo devuelve Materia
   prima. ¿Está bien, o todo lo que sobra vuelve siempre al depósito?
2. **Lista para llevar** (Daniela): muestra las tandas atrasadas, de hoy, de
   mañana y sin día. ¿Les sirve así o sólo las del día?
3. **4 bolsas por carga** (David): ¿también para el master, o el master va
   aparte como ahora? ¿Alguna receta lleva más de 4 bolsas?
4. **Nombres de los turnos** (Eduardo): entre las 13 y las 16 se superponen
   mañana y tarde en el esquema doble. ¿Los llamamos distinto (ej. «Tarde
   12 a 21»), o alcanza con mostrar los horarios?
5. **Foto del producto** (Eduardo): en Stock de productos se puso el color.
   ¿Quieren una foto de cada modelo? En ese caso, ¿nos la pasan?
6. **Borde / Esquinero** (Eduardo): en la reunión se dijo «que le pongamos
   borde». ¿Qué producto hay que renombrar?
7. **Lote: materia prima o inyección** (Eduardo, con la gente de las ISO): hoy
   la partida se abre por producción. Queda como está hasta que lo definan.
8. **Ingreso sin compra** (Daniela): si el material tiene una compra abierta,
   se pide el motivo. ¿Hay casos en que esto moleste?
9. **Lector con visor** (Eduardo): se prueba en la próxima visita.
10. **Pedidos de prueba viejos** (Matías): falta borrarlos (están vencidos
   hace días). Se hace con su OK, en una tanda aparte.
