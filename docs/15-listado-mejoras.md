# 15 · Listado de mejoras NEXA — implementación y verificación

Fuente: `Listado mejoras NEXA.docx` (cliente). Se implementó sobre lo existente
(commit 77847b4) y se verificó en dos niveles:

- **Tests**: 139/139 (`npx vitest run --testTimeout=30000 --hookTimeout=60000`);
  `tests/listado-mejoras.test.ts` cubre las reglas nuevas. Lint y `next build` OK.
- **Interfaz real** sobre una **copia local de la base** (Neon → PGlite servida en
  127.0.0.1:5433, configuración `nexa-erp-copia` en `.claude/launch.json`, con
  `?max=1` porque PGlite atiende una conexión). Neon no se tocó: después de las
  pruebas el último pedido real sigue siendo #90 y el último retiro RM-00004.

Migración: `drizzle/0010_mejoras_listado_nexa.sql` (sólo agrega; ya aplicada).

## Matriz de cumplimiento

| ID | Página / sección | Requerimiento | Estado | Evidencia | Prueba y resultado |
|---|---|---|---|---|---|
| P-01 | Pedidos · alta | El número de orden se asigna solo. | COMPLETADO Y VERIFICADO | Secuencia pedido_numero_seq (migración 0010), continúa desde el mayor número existente; crearPedido. | Interfaz: pedido nuevo recibió N° 81475 sin escribirlo. Test: correlativo y número duplicado rechazado. OK. |
| P-02 | Pedidos · alta | Sin fecha de entrega comprometida, se propone una semana después del pedido. | COMPLETADO Y VERIFICADO | entregaPorDefecto(); campo precargado y editable. | Interfaz: pedido del 18/10 propone 25/10. Test de la regla. OK. |
| P-03 | Pedidos · alta | Lista desplegable con dibujo chico al costado del modelo y del color. | COMPLETADO Y VERIFICADO | Selector visual con foto de Rejilla, Ciego Trama y Ciego Moneda (tomadas del documento) y muestra de color (color.hex). | Interfaz: fotos y muestras visibles. Se corrigió un defecto de diseño del botón (imagen y texto apilados). Accesorios sin imagen: no se proveyeron. |
| P-04 | Pedidos · listado | Ordenado por fecha, lo más nuevo arriba. | COMPLETADO Y VERIFICADO | listarPedidos: orden por defecto fecha de pedido descendente. | Interfaz: el pedido recién cargado aparece primero. Test. OK. |
| P-05 | Pedidos · listado | Botones para ordenar por fecha de pedido, alfabético o fecha de entrega. | COMPLETADO Y VERIFICADO | Botones «Fecha de pedido», «Cliente (A-Z)», «Fecha de entrega». | Interfaz: los tres órdenes. Test de los tres criterios. OK. |
| P-06 | Pedidos · alta | La prioridad se pregunta en la misma pantalla de carga. | COMPLETADO Y VERIFICADO | Campo Prioridad junto a la fecha de entrega; si no es automática pide motivo (queda en historial). | Interfaz: pedido cargado como Urgente con motivo, sin pantalla intermedia. OK. |
| P-07 | Pedidos · alta | Después de cargar, vuelve a Pedidos con un mensaje que aparece y desaparece. | COMPLETADO Y VERIFICADO | Redirección a /pedidos con aviso temporal; el parámetro se limpia de la dirección (recargar no repite el aviso). | Interfaz: «Su pedido fue cargado con éxito», desaparece a los pocos segundos. OK. |
| P-08 | Pedidos · listado | Quitar de Pedidos el material comprometido; a lo sumo en Stock de productos. | COMPLETADO Y VERIFICADO | La tabla se movió a Stock de productos; en Pedidos queda una línea que indica dónde está. | Interfaz: verificado en ambas pantallas. OK. |
| P-09 | Pedidos · a armar | Listado de pedidos a armar con botón «Comenzar a armar pedido» en cada renglón. | COMPLETADO Y VERIFICADO | Vista «A armar»; columnas ajustadas para que el botón se vea sin desplazar la tabla. | Interfaz: botón por renglón (se corrigió que quedaba fuera de pantalla a 1024 px). OK. |
| P-10 | Pedidos · a armar | Si hace falta producir primero, el botón aparece en gris. | COMPLETADO Y VERIFICADO | disponibilidadArmado(): sin stock libre el botón se deshabilita con la leyenda «Necesita producción o stock libre». | Test automatizado OK. En los datos actuales no hay un pedido sin nada de stock para verlo en pantalla. |
| P-11 | Pedidos · a armar | Si se puede armar una parte, lo permite con una alerta de que falta producir. | COMPLETADO Y VERIFICADO | Leyenda en el renglón y confirmación al tocar el botón. | Interfaz: «Se pueden armar 73 de 508 unidades; faltan 435 por producir». OK. |
| P-12 | Armado | Lo que se llamaba despacho pasa a llamarse «Armado de pedido». | COMPLETADO Y VERIFICADO | Títulos y pasos: «Armado de pedido y primer control» / «Segundo picking y despacho». | Interfaz. OK. |
| P-13 | Armado | Tilde «Caja completa» que bloquea la cantidad; al destildar se habilita. | COMPLETADO Y VERIFICADO | Lector con tilde; con tilde toma todo lo que tiene la caja. | Interfaz: caja completa (25 u.) y caja abierta destildando (3 u.). Se agregó la columna «Falta armar». OK. |
| P-14 | Armado | Al confirmar el primer control, cartel «listo para despachar» o «parcialmente armado». | COMPLETADO Y VERIFICADO | confirmarPrimerControl devuelve si fue parcial; mensaje según el caso. | Interfaz: «el pedido quedó parcialmente armado…». Test de ambos casos. OK. |
| P-15 | Armado | Volver a Pedidos; no quedarse en el pedido ni permitir el control final. | COMPLETADO Y VERIFICADO | Redirección a /pedidos al confirmar. | Interfaz. OK. |
| P-16 | Pedidos · listos | En «Listo para despachar», botón «Despachar» que lleva a chequear, volver a pickear y despachar. | COMPLETADO Y VERIFICADO | Botón por renglón; pantalla con lo que incluye el despacho y segundo picking obligatorio. | Interfaz: segundo picking 28/28 y entrega con remito interno. OK. |
| P-17 | Pedido | Botón más grande «Imprimir remito para entrega». | COMPLETADO Y VERIFICADO | Botón destacado tras la entrega; abre el remito con original y duplicado. | Interfaz. OK. |
| P-18 | Pedido | Formato del remito. | PENDIENTE POR DEFINICIÓN EXTERNA | Se usa el remito interno actual. | Lo indica el propio documento: falta definir el formato. |
| S-01 | Stock de productos | «Ver existencias»: cajas con código y cantidad; ver rápido las cajas abiertas. | COMPLETADO Y VERIFICADO | existenciasProducto(); filtro «Sólo abiertas»; marca Completa / Abierta. | Interfaz: Negro con 3 cajas, una abierta (5/25). Test. OK. |
| S-02 | Stock de productos | En los de rejilla, el tipo dice «Rejilla». | COMPLETADO Y VERIFICADO | etiquetaTipo(): «Rejilla» / «Ciego» en vez de «Único». | Interfaz. Test. OK. |
| C-01 | Clientes | Ordenar por nombre. | COMPLETADO Y VERIFICADO | Orden A→Z y Z→A. | Interfaz. Test. OK. |
| C-02 | Clientes | Al entrar a cada cliente, ver su historial de pedidos (no sólo editar). | COMPLETADO Y VERIFICADO | Ficha con pedidos, productos, despachos/remitos y estado. | Interfaz. Test. OK. |
| PR-01 | Producción | Planificar viendo cada día y los tres turnos, con una tarjeta por turno. | COMPLETADO Y VERIFICADO | Pestaña «Calendario por turno», semana a semana. | Interfaz. OK. |
| PR-02 | Producción | Mover la tarjeta con el mouse de un día o turno a otro. | COMPLETADO Y VERIFICADO | Arrastrar y soltar; se guarda al soltar. En celular, «Mover a…». | Interfaz: tarjeta movida al lunes mañana, persiste al recargar. El navegador de prueba no genera arrastres nativos: se dispararon los eventos de arrastre en la página. |
| PR-03 | Producción | Tarjeta con información reducida: cantidades, producto y material requerido. | COMPLETADO Y VERIFICADO | Color, producto, cantidad, material requerido; si falta receta lo indica. | Interfaz. Se agregó «Receta sin definir» cuando no hay receta. |
| UI-01 | General | El menú lateral entra completo y no se desplaza con la pantalla. | COMPLETADO Y VERIFICADO | Menú fijo con desplazamiento propio. | Interfaz: con la página desplazada el menú sigue fijo. OK. |
| OP-01 | Operario | El encargado asigna la tanda al turno; la inicia el operario. | COMPLETADO Y VERIFICADO | iniciarProduccionDeTanda permite al operario la máquina asignada con fecha de hoy o anterior. | Interfaz: asignada como Gerencia, iniciada con el usuario de taller. Test de permisos. OK. |
| OP-02 | Operario | Al iniciar sólo se ponen los golpes; piezas por golpe preestablecidas. | COMPLETADO Y VERIFICADO | Golpes precargados con el último registro; «4 por golpe» desde el producto. | Interfaz. OK. |
| OP-03 | Operario | La carga se llama «Registrar carga en tolva de material a pie de máquina». | COMPLETADO Y VERIFICADO | Título de la sección. | Interfaz. OK. |
| OP-04 | Operario | Listado precargado con lo que corresponde a esa producción; se tilda al cargar. | COMPLETADO Y VERIFICADO | Receta de la producción con tildes y ± media bolsa; motivo si difiere. | Interfaz. OK. |
| OP-05 | Operario | Lo cargado se descuenta del stock a pie de máquina. | COMPLETADO Y VERIFICADO | Movimiento pie de máquina → tolva en la misma transacción. | Interfaz: 2 bolsas → 1 bolsa a pie de máquina. Test. OK. |
| OP-06 | Operario | Sólo el nombre del operario logueado; sin inyectora, quién entregó ni piezas previstas. | COMPLETADO Y VERIFICADO | Usuario propio: queda a su nombre sin escribirlo. Cuenta compartida «Taller»: se pide el nombre una vez por turno. | Interfaz. Se corrigió que «Responsable» y el historial mostraran «vos» o «Taller» en lugar del nombre. |
| OP-07 | Operario | Un solo paso: la carga en tolva confirma el retiro de pie de máquina. | COMPLETADO Y VERIFICADO | cargarReceta: un único registro. | Interfaz. Test. OK. |
| OP-08 | Operario | Opción «Uso de material a pie de máquina»; destildada retira del stock general. | COMPLETADO Y VERIFICADO | Destildada: retiro del stock general a nombre del operario y carga en el mismo paso. | Interfaz: pie de máquina sin cambios, tolva +25,6 kg. Se corrigió el mensaje, que decía «del pie de máquina». |
| OP-09 | Operario | Lectura opcional de código de barras (a confirmar si lo usan). | PENDIENTE POR DEFINICIÓN EXTERNA | «Leer bolsa (opcional)» valida que el código sea de ese material. | Test automatizado OK (rechaza código de otro material). Falta confirmar si en planta se lee el código; hoy no hay lotes con código cargados. |
| OP-10 | Operario | Cantidad en bolsas completas según los parámetros (ej. 25 kg = 1 bolsa). | COMPLETADO Y VERIFICADO | Recetas en presentaciones físicas. | Interfaz: «25 kg (1 bolsa de 25 kg)», «600 g (1 bolsita de 600 g)». Se corrigió que 1,2 kg de master se mostrara como «1½ bolsitas de 750 g + 0,075 kg»; ahora «2 bolsitas de 600 g». |
| OP-11 | Operario | Al cargar en tolva no se registra sobrante; sólo al terminar, como scrap. | COMPLETADO Y VERIFICADO | Sobrante sólo en «Finalizar producción». | Interfaz: finalizada con 2 kg de sobrante y 0,5 kg de scrap. OK. |
| OP-12 | Operario | Si un sobrante puede usarse como materia prima, lo define el encargado por producto. | PENDIENTE POR DEFINICIÓN EXTERNA | Parámetro «Acepta sobrante» por producto (Configuración → Productos), desactivado por defecto. | Test OK. Falta que NEXA confirme en qué productos. |
| OP-13 | Operario | Al cargar la tolva, el operario sigue con la producción sin pasos extra; puede pausar o cancelar con motivo y finalizar. | COMPLETADO Y VERIFICADO | Inicio con golpes y, en la misma pantalla, la carga precargada; pausa/reanudación, cancelación y finalización con motivo. | Interfaz: inicio, carga, pausa con motivo, reanudación y finalización. Cancelación: test automatizado (no se canceló una producción en la prueba manual). |
| OP-14 | Operario | El turno no se elige: sale de la hora del día. | PENDIENTE POR DEFINICIÓN EXTERNA | Turno automático por horario configurable (Parámetros); mientras no esté configurado se elige con un botón, ya marcado según la tanda. | Test de la regla de horarios OK. Falta que NEXA informe los horarios de cada turno (no se inventaron). |
| OP-15 | Operario | Dos botones claros: «Cerrar mi turno y dejar relevo» y «Finalizar producción»; los campos aparecen al elegir. | COMPLETADO Y VERIFICADO | Componente de dos botones. | Interfaz. OK. |
| OP-16 | Operario | El que llega ve la máquina, retoma indicando si coincide o hay diferencia, con su nombre. | COMPLETADO Y VERIFICADO | Inicio del taller con las máquinas disponibles; «Retomar la máquina» con lo informado al cierre. | Interfaz: relevo con «Coincide» y otro nombre; las piezas del turno se calcularon solas. OK. |
| M-01 | Materia prima | Dividido en Stock general y Stock a pie de máquina. | COMPLETADO Y VERIFICADO | Dos pestañas, dos depósitos. | Interfaz. OK. |
| M-02 | Materia prima | Cada depósito con su listado y sus movimientos; todo queda registrado. | COMPLETADO Y VERIFICADO | Libro de movimientos con filtro por depósito; ficha de cada material. | Interfaz: retiro, carga, consumo, sobrante y devolución con sus movimientos. Test de saldos. OK. |
| M-03 | Materia prima | Retiro del general al pie de máquina y reingreso de devoluciones o sobrante. | COMPLETADO Y VERIFICADO | Retiro a pie de máquina; «Devolver sin mezclar»; sobrante con su código. | Interfaz: retiro de 51,2 kg, devolución de 25 kg al general. OK. |
| M-04 | Materia prima | Aclarar la sección «Ajustes y variantes». | COMPLETADO Y VERIFICADO | Renombrada «Operaciones de stock», con explicación de cada operación. | Interfaz. OK. |
| M-05 | Materia prima | Sin indicadores en el stock general. | COMPLETADO Y VERIFICADO | Se quitaron. | Interfaz. OK. |
| M-06 | Materia prima | En pie de máquina, indicadores con cuántas bolsas debería haber. | COMPLETADO Y VERIFICADO | Tarjetas por máquina y material, en bolsas. | Interfaz. OK. |
| M-07 | Materia prima | Al hacer clic en la materia prima se ven sus lotes y certificados. | COMPLETADO Y VERIFICADO | Botón «Lotes y certificados» en cada material. | Interfaz. (El stock importado de la planilla no tiene lotes.) OK. |

## Correcciones de la verificación (esta pasada)

- `selector-visual.tsx`: `.input` (CSS sin capa) pisaba `flex` de Tailwind → `style={{ display: "flex" }}`.
  Ojo general: las clases propias de `globals.css` (`.input`, `.badge-estado`) ganan sobre las utilidades.
- `pedidos/page.tsx`: Líneas/Total sólo desde `xl`; badges de entrega debajo de la fecha; la situación puede cortar línea; `?vista=despachar` aceptado.
- `despacho/page.tsx`: «Pendiente de entregar» + «Falta armar».
- `taller/page.tsx`: `NombreOperario` (usuario propio = nombre fijo; cuenta «Taller» = pide nombre, requerido); responsable con nombre; turno preseleccionado según la tanda; la novedad «Pausa: …» no se repite en el historial.
- `taller.ts`: `eventosDe` toma el `operario_nombre` del turno vigente; `enBolsas` prefiere la presentación exacta; foto al cierre con `fmtPeso`.
- `actions/taller.ts`: mensaje de carga según el origen (pie de máquina / stock general).
- `calendario.tsx`: «Receta sin definir» en la tarjeta.

## Preguntas abiertas (responde: Gerencia CPS / gerente de producción)

1. Formato del remito para entrega (P-18).
2. ¿Se lee el código de barras de las bolsas en planta? (OP-09).
3. ¿Qué productos aceptan sobrante como materia prima? (OP-12) — hoy `acepta_sobrante = false` en todos.
4. Horario de inicio de cada turno (OP-14) — parámetros `turno_*_inicio = -1`.
5. Recetas de carga: 0 de 94 productos tienen receta en producción. Sin receta el operario no ve el listado precargado.
6. ¿Un usuario por operario o cuenta compartida «Taller»? Asunción tomada: con la cuenta compartida (detectada por el nombre «Taller») se pide el nombre por turno; los movimientos de stock quedan a nombre de la cuenta.
7. Asunción: si el operario destilda «pie de máquina», el retiro del general y la carga ocurren juntos, y la carga descuenta del pie de máquina por orden de retiro (el más viejo primero). El total es el mismo.
8. Imágenes de accesorios (esquineros y rampas): no se recibieron.
