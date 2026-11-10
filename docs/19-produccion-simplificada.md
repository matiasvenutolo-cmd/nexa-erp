# 19 · Producción simplificada (cambios 1, 2 y 3 + calendario por máquina)

Fuente: «Cambios en Producción: detalle para desarrollo» (07/11/2026) y la
revisión con decisiones (`docs/entregables/NEXA - Cambios en Producción -
revisión y decisiones`). Sin migraciones: todo con las tablas existentes.

## Cambio 1 · uno asigna, otro arranca
- Se quitan «Iniciar producción» de la tanda y «Inicio de producción sin
  planificar» (página `/produccion/nuevo` eliminada). Arranca sólo el operario
  desde Mi turno, y eso abre producción y turno juntos.
- Cola por máquina (`colaDeMaquina`): día, turno (mañana/tarde/noche) y orden.
  Arrancar otra que no es la primera pide motivo; queda como novedad
  «Arranque fuera de orden» en Relevos y novedades.
- El Encargado/Supervisión puede arrancar «en nombre del operario» desde «Ver
  como el operario»: elige el operario y pone motivo.
- Golpes de inicio precargados con el cierre anterior de la máquina.
- «Planificada» se muestra «En cola» (el estado guardado no cambia).

## Cambio 2 · el material llega sólo por un retiro
- Se elimina la carga desde el stock general (casilla «Uso de material a pie de
  máquina») y la lectura de bolsa en la carga. El operario no puede retirar.
- «Llevar material» desde la tanda en cola (`/materia-prima/retiro?tanda=…`):
  el retiro queda con inyectora y producto previsto y pasa a la producción al
  arrancar. «Reponer material» desde la tanda en curso y desde En curso.
- La carga descuenta sólo del pie de máquina de esa producción
  (`retirosDeProduccion`): lo llevado para otra tanda de la cola no se toca.
- «Pedir material» (novedad «Pedido de material»): aviso arriba en Producción y
  en Materia prima hasta que se hace un retiro para esa máquina.
- Cancelar una producción: sólo Encargado/Supervisión/Gerencia (En curso).

## Cambio 3 · app del operario por estados
Sin tanda → Tanda en cola (Arrancar) → Falta cargar (Ya cargué · Cargué
distinto · Pedir material) → Produciendo («Terminá cuando el contador marque N»,
Cargué otra vez, Terminar en color fuerte, Pausar, Cerrar mi turno); Relevo
(Recibí la máquina · Falta material a pie de máquina; tolva estimada sólo
informativa) y Pausada (Reanudar). Descarte en piezas (se guarda en kg con el
peso por pieza); el cierre muestre «Producidas · Descarte · A stock» antes de
confirmar. Nombres cortos de material en planta (`nombreCortoMp`). La máquina
queda recordada en el celular; «Cambiar de máquina» va al menú y lleva a la lista.

## Cambio 4 (parcial) · calendario con una columna por máquina
Cada día tiene una columna por inyectora (8 baldosas, 6 accesorios, y otras si
tienen tandas). Arrastrar entre columnas cambia la máquina; las baldosas no se
pueden soltar fuera de la 8 ni los accesorios en la 8.

## Pendiente con la empresa
Cambios 5, 6 y 7 (aprobación, ficha y avisos, etiquetas) y los casos de la
revisión. Mientras no exista la aprobación, rebarba, scrap y sobrante se siguen
cargando al terminar (opcionales, plegados).

## Preguntas abiertas (responde: Gerencia CPS / Nachi)
1. Una tanda programada para un día futuro no se puede arrancar (hay que
   moverla en el calendario). ¿Se mantiene?
2. ¿Los accesorios pueden ir a otra inyectora que no sea la 6?
