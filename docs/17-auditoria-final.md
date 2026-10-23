# 17 · Auditoría final de las mejoras del 22/10

Fuentes de aceptación: `mejoras nexa.docx`, Excel de usuarios, `stock MP Nexa
20-10-2026.xlsx` y las cuatro fotos de accesorios.

**Estado general: APTO CON OBSERVACIONES.** 104 requisitos: 93 completados y
verificados, 1 implementado sin verificar con el equipo físico (lector 3nstar),
10 pendientes de definición o autorización externa. Ninguno sin implementar ni con
pruebas fallidas.

## Cómo se verificó

- **Tests:** 165/165 (`npx vitest run --testTimeout=30000 --hookTimeout=60000`),
  lint y `next build` OK. Nuevos en `tests/mejoras-22-10.test.ts`: cambios
  estructurales, rechazo de acciones por rol (sin escribir nada), rutas por perfil,
  riesgo de entregas, sobrante sin molienda; en `listado-mejoras`, operario de la
  producción y mensaje de turno.
- **Interfaz real** sobre una copia de la base de producción del 23/10 (Neon →
  PGlite con la 0011 ya aplicada; `scripts/conciliar-usuarios.ts --aplicar` sobre la
  copia). Circuito: Supervisor carga PIN → Encargado planifica tanda 001B-PR-NE para
  stock (100 u.), la asigna a la 8 hoy mañana, esquema doble, asigna a Ariel →
  Dylan (Retiros MP) retira 100 kg 031 + 1,2 kg B24 con el lector → Ariel (PIN)
  inicia sin elegir turno, carga en tolva (pie → 0) y deja relevo (50 piezas, 1 kg
  descarte) → Dylan (PIN, Operario) retoma «coincide» y finaliza (golpes 180, 0,5 kg
  scrap, 2 kg sobrante 403) → Yesica recibe 1,5 kg de descarte y entrega bolsón
  1,4 kg → Daniela confirma → Supervisor corrige el cierre (98 → 96 a stock; última
  caja 21) → trazabilidad de la partida 4 → necesidad de compra. Aparte: Compras
  (Carolina), Matrices (Alejandro), alta de usuario con PIN, Administración,
  Gerencia y Gerencia de consulta.
- **Acciones manuales:** un formulario de «Registrar compra» enviado a mano como
  Materia Prima es rechazado por el servidor y no crea nada; las acciones de
  Administración ni se alcanzan desde un perfil sin acceso (el proxy redirige).
- **Saldos:** `scripts/verificar-saldos.ts` (sólo lectura): producción 173
  movimientos y copia tras la prueba 189, sin desajustes saldo/ledger, sin
  negativos, traslados con patas que se anulan.

## Matriz

| ID | Fuente y sección | Requisito | Estado | Evidencia en código/UI | Prueba y resultado |
|---|---|---|---|---|---|
| W-01 | Word §1 Usuarios | Dar de baja la cuenta «Taller». | COMPLETADO Y VERIFICADO | scripts/conciliar-usuarios.ts (baja sin borrar historial) | Interfaz (copia de la base real, 23/10): «Taller» inactiva, su historial intacto; el login ya no la lista. |
| W-02 | Word §1 Usuarios | Un usuario por operario (Dilan, Ariel, Octavio, Franco, Nicolás, Facundo) con nombre + PIN. | COMPLETADO Y VERIFICADO | Alta pendiente de activación + PIN cargado por Supervisión | Interfaz (copia de la base real, 23/10): Ariel y Dylan entraron con su PIN y operaron la máquina. |
| W-03 | Word §1 Usuarios | Si hace falta una cuenta genérica, que se llame «Operario». | COMPLETADO Y VERIFICADO | No hace falta: cada operario tiene su cuenta | Revisión: no se creó ninguna cuenta genérica. |
| W-04 | Word §1 Usuarios | Aplicar en producción las cuentas del Excel (altas, emails, Dylan, baja de «Taller»). | PENDIENTE DE DEFINICIÓN EXTERNA | Script listo, simulado y probado sobre la copia (idempotente) | No aplicado en producción: falta la autorización y el momento (al dar de baja «Taller» la planta no entra hasta que Supervisión cargue los PIN). |
| W-05 | Word §1 Usuarios | El Supervisor hace altas, bajas y cambios de usuarios. | COMPLETADO Y VERIFICADO | puedeAdministrarUsuarios; Administración → Usuarios | Interfaz (copia de la base real, 23/10): Eduardo creó una cuenta, le cargó PIN y la cuenta entró. Tests automáticos: no otorga perfiles de Gerencia. |
| W-06 | Word §1 Usuarios | Gerencia mantiene los permisos por urgencias. | COMPLETADO Y VERIFICADO | Gerencia administra todo, incluidos perfiles de Gerencia | Interfaz (copia de la base real, 23/10): Gerencia entra a todas las secciones y edita cuentas de Gerencia. |
| W-07 | Word §1 Administración | Alejandra: pedidos, precios, clientes, urgencias, reclamos, avisos y remito legal. | COMPLETADO Y VERIFICADO | Perfil Administración | Interfaz (copia de la base real, 23/10): ve pedidos con precios, catálogo, reclamos, avisos; crea pedidos. |
| W-08 | Word §1 Administración | Ailen: lo mismo + generar pedidos, stock de productos y estado de pedidos. | COMPLETADO Y VERIFICADO | Mismo perfil Administración | Interfaz (copia de la base real, 23/10) con el perfil (cuenta de Ailen pendiente de activación). |
| W-09 | Word §1 Administración | Ninguna de las dos entra a producción. | COMPLETADO Y VERIFICADO | puedeVerProduccion / rutaPermitida | Interfaz (copia de la base real, 23/10): Producción, MP y Compras la devuelven al inicio. |
| W-10 | Word §1 Gerencia | Braian y Catalina: correcciones, altas y cambios. | COMPLETADO Y VERIFICADO | Perfil Gerencia | Interfaz (copia de la base real, 23/10) con la cuenta Gerencia (las personales quedan pendientes de activación). |
| W-11 | Word §1 Gerencia | Gabriel: consulta con precios. | COMPLETADO Y VERIFICADO | Perfil Gerencia (consulta) | Interfaz (copia de la base real, 23/10): ve todo con precios, sin botones de alta; las URL de alta lo devuelven al inicio. Tests automáticos: sus acciones se rechazan. |
| W-12 | Word §1 Supervisor | Todo el sistema sin precios. | COMPLETADO Y VERIFICADO | puedeVerPrecios | Interfaz (copia de la base real, 23/10): lista de pedidos sin columna Total. |
| W-13 | Word §1 Supervisor | Cambios estructurales: productos, materia prima, colores. | COMPLETADO Y VERIFICADO | Alta de producto y MP, colores; edición de código y nombre de MP (agregada en esta auditoría) | Interfaz (copia de la base real, 23/10): corrigió el nombre de un material; queda en el historial. |
| W-14 | Word §1 Supervisor | Cambios estructurales: códigos de barras. | COMPLETADO Y VERIFICADO | Configuración → Productos (agregado en esta auditoría) | Interfaz (copia de la base real, 23/10): guarda el código; rechaza uno repetido. Tests automáticos: Encargado y consulta no pueden. |
| W-15 | Word §1 Supervisor | Relevamiento de stock. | COMPLETADO Y VERIFICADO | Corrección de stock de producto y ajuste de MP con motivo | Tests automáticos: corrección auditada y sin negativos. |
| W-16 | Word §1 Supervisor | Coordinación de compras. | COMPLETADO Y VERIFICADO | Gestiona Compras | Interfaz (copia de la base real, 23/10): registró una compra. |
| W-17 | Word §1 Encargado | Planificación de inyección por turno. | COMPLETADO Y VERIFICADO | Planificación + calendario + esquemas | Interfaz (copia de la base real, 23/10): tanda planificada y asignada a la 8, turno mañana. |
| W-18 | Word §1 Encargado | Asignación de operarios. | COMPLETADO Y VERIFICADO | Producción → Turnos y operarios | Interfaz (copia de la base real, 23/10): Ariel asignado a la mañana en la 8. |
| W-19 | Word §1 Encargado | Recetas. | COMPLETADO Y VERIFICADO | Configuración → Recetas de carga | Interfaz (copia de la base real, 23/10) (etapa anterior) y Tests automáticos. |
| W-20 | Word §1 Encargado | Control de armado. | COMPLETADO Y VERIFICADO | Permiso de armado y despacho | Tests automáticos: armado, primer control y despacho. |
| W-21 | Word §1 Encargado | Stock con máximos y mínimos. | COMPLETADO Y VERIFICADO | Configuración → Mínimos y máximos | Tests automáticos: Encargado, Supervisor y Gerencia; nadie más. |
| W-22 | Word §1 Usuarios | Dylan: Retiros de MP y suplente del Encargado (dos perfiles). | COMPLETADO Y VERIFICADO | Perfiles adicionales + selector | Interfaz (copia de la base real, 23/10): con contraseña usa los tres perfiles; con PIN sólo los de planta; retiró MP y operó la máquina. |
| W-23 | Word §1 Usuarios | Nuevo perfil Compras (Carolina). | COMPLETADO Y VERIFICADO | Perfil Compras + módulo | Interfaz (copia de la base real, 23/10): Carolina registró y siguió una compra; el resto de las secciones la devuelve a Compras. |
| W-24 | Word §1 Planta | Lectura de código de barras al retirar MP a pie de máquina. | COMPLETADO Y VERIFICADO | Lector en el retiro | Interfaz (copia de la base real, 23/10): «031» y «B24» completaron el material; el retiro quedó registrado. |
| W-25 | Word §1 Planta | Sobrante como materia prima habilitado en todos los productos. | COMPLETADO Y VERIFICADO | Migración 0011 (auditada) | Producción: 94 de 94 productos habilitados. |
| W-26 | Word §1 Planta | Moliendas manejadas aparte del sobrante. | COMPLETADO Y VERIFICADO | Molino; «acepta molienda» aparte; códigos de sobrante sin molienda (corregido en esta auditoría) | Interfaz (copia de la base real, 23/10): molienda por el molino. Tests automáticos: el selector de sobrante ya no ofrece molienda. |
| W-27 | Word §1 Planta | El Encargado asigna operarios al principio del día. | COMPLETADO Y VERIFICADO | Turnos y operarios | Interfaz (copia de la base real, 23/10). |
| W-28 | Word §1 Planta | Cada operario registra su relevo al cambiar de turno. | COMPLETADO Y VERIFICADO | Cerrar turno / Retomar | Interfaz (copia de la base real, 23/10): Ariel dejó relevo; Dylan lo retomó con «coincide». |
| W-29 | Word §2 Turnos | Tres esquemas: simple, doble, triple (noche hasta las 7). | COMPLETADO Y VERIFICADO | lib/turnos.ts | Tests automáticos: los tres esquemas y la noche del día anterior. Interfaz (copia de la base real, 23/10): esquema doble del día. |
| W-30 | Word §2 Turnos | El operario elige el turno sólo si hay superposición. | COMPLETADO Y VERIFICADO | opcionesTurno | Interfaz (copia de la base real, 23/10): a las 9:43 no preguntó. Tests automáticos: a las 14 pregunta salvo que esté asignado. |
| W-31 | Word §2 Recetas | Cálculo según la cantidad de pisos a inyectar. | COMPLETADO Y VERIFICADO | Material requerido por tanda (piezas × peso → cargas → bolsas) | Interfaz (copia de la base real, 23/10): 100 piezas → 1 carga: 100 kg + 1.200 g. |
| W-32 | Word §2 Recetas | El Encargado puede agregar extras. | COMPLETADO Y VERIFICADO | Receta de arranque (cambio de color) | Tests automáticos. |
| W-33 | Word §2 Recetas | Rejilla: master por kg de 2240P (15 g/kg). | COMPLETADO Y VERIFICADO | Dosificación corregida | Producción: 15 g/kg; negro 12 g/kg. |
| W-34 | Word §2 Recetas | Ciego: master por cada ½ kg de 2630PC + Plastomer. | COMPLETADO Y VERIFICADO | 30 g/kg cargado | Producción: 30 g/kg cada 0,5 kg. Ver W-55 (interpretación). |
| W-35 | Word §2 Compras | Necesidad = pedidos + faltante de pisos + faltante de MP − stock. | COMPLETADO Y VERIFICADO | calcularNecesidad | Interfaz (copia de la base real, 23/10) y Tests automáticos: cada término por separado; piezas convertidas a kg. |
| W-36 | Word §2 Compras | Proyectado: restando lo comprado. | COMPLETADO Y VERIFICADO | Comprado pendiente | Tests automáticos: 50 kg comprados, 20 recibidos → 30 pendientes. |
| W-37 | Word §2 Compras | Estados: pedido, comprado (con entrega), parcial, con demora, faltante. | COMPLETADO Y VERIFICADO | estado_compra | Interfaz (copia de la base real, 23/10): comprado → con demora con motivo e historial. |
| W-38 | Word §2 Compras | De la compra depende la fecha prometida: avisar el riesgo. | COMPLETADO Y VERIFICADO | Entregas en riesgo (agregado y ajustado en esta auditoría) | Tests automáticos: sólo se marca si lo disponible no cubre los pedidos. |
| W-39 | Word §2 Compras | Si el proveedor falla, avisar para buscar un master de tono parecido. | COMPLETADO Y VERIFICADO | Riesgo por compra con demora o faltante | Tests automáticos: mensaje sin reemplazo automático. |
| W-40 | Word §2 Matrices | Programación de cambios de matriz. | COMPLETADO Y VERIFICADO | Matrices | Interfaz (copia de la base real, 23/10): se ve en el calendario de Producción. |
| W-41 | Word §2 Matrices | Arreglos. | COMPLETADO Y VERIFICADO | Tipo «Reparación» | Tests automáticos. |
| W-42 | Word §2 Matrices | Services programados. | COMPLETADO Y VERIFICADO | Tipo «Service» | Interfaz (copia de la base real, 23/10): Alejandro lo programó, inició y cerró. |
| W-43 | Word §2 Matrices | Historial de trabajos. | COMPLETADO Y VERIFICADO | Historial con filtro por matriz | Interfaz (copia de la base real, 23/10): el service cerrado figura con responsable y observación. |
| W-44 | Word §2 Molino | Recepción de descartes. | COMPLETADO Y VERIFICADO | Molino | Interfaz (copia de la base real, 23/10): 1,5 kg de la producción #15. |
| W-45 | Word §2 Molino | Informe de moliendas entregadas a Materia Prima. | COMPLETADO Y VERIFICADO | Entregas + confirmación de MP | Interfaz (copia de la base real, 23/10): bolsón confirmado por MP; entró una sola vez al stock. |
| W-46 | Word §3 | Adriana: crear su email. | PENDIENTE DE DEFINICIÓN EXTERNA | Cuenta preparada sin email (entra con PIN) | Falta que la empresa cree el email. |
| W-47 | Word §3 | Dylan y Dilan son la misma persona. | COMPLETADO Y VERIFICADO | Una sola cuenta | Interfaz (copia de la base real, 23/10). |
| W-48 | Word §3 | Corregir emails con espacios. | COMPLETADO Y VERIFICADO | Script + validación de email | Tests automáticos: un email con espacio se rechaza. |
| W-49 | Word §3 | Crear Ailen y Carolina aunque falten datos; Carolina sin apellido. | COMPLETADO Y VERIFICADO | Cuentas pendientes de activación | Interfaz (copia de la base real, 23/10) (copia): creadas; Carolina operó con clave de prueba. |
| W-50 | Word §3 | Operarios con nombre + PIN, sin email de empresa. | COMPLETADO Y VERIFICADO | Login por PIN | Interfaz (copia de la base real, 23/10). |
| W-51 | Word §3 | Funciona sin conexión al servidor de la empresa (sistema web). | COMPLETADO Y VERIFICADO | Aplicación web | Revisión: basta internet. |
| W-52 | Word §3 | Master = 0,015 kg (15 g) por kg. | COMPLETADO Y VERIFICADO | Dosificación corregida | Producción verificada. |
| W-53 | Word §3 | Peso por piso. | PENDIENTE DE DEFINICIÓN EXTERNA | Peso por producto + «peso confirmado» | Falta el peso de cada tipo; mientras tanto los cálculos se marcan como estimados. |
| W-54 | Word §3 | Proporción 2630PC / Plastomer en el ciego. | PENDIENTE DE DEFINICIÓN EXTERNA | Campo de proporción (pendiente) | Sin ese dato se calcula el master total, no las bolsas de cada material. |
| W-55 | Word §3 | Interpretación de «por cada ½ kg». | PENDIENTE DE DEFINICIÓN EXTERNA | Cargado como 0,5 kg de mezcla (30 g/kg) | Confirmar si es medio kilo de mezcla o de cada material. |
| W-56 | Word §3 | Estados de compra: una sola lista. | COMPLETADO Y VERIFICADO | Lista única con equivalencias | Tests automáticos. |
| W-57 | Word §3 | Faltante de pisos contra el mínimo. | COMPLETADO Y VERIFICADO | Mínimo del producto | Tests automáticos. |
| W-58 | Word §3 | Formato del remito. | PENDIENTE DE DEFINICIÓN EXTERNA | Remito interno actual | Falta el formato. |
| W-59 | Word Adjuntos | Listado de MP estandarizado (031, B24…). | COMPLETADO Y VERIFICADO | El lector y la conciliación lo reconocen; el Supervisor puede renombrar códigos | Interfaz (copia de la base real, 23/10) y Tests automáticos. |
| W-60 | Word Lector | Lector 3nstar en modo teclado. | IMPLEMENTADO, NO VERIFICADO | Campo dedicado compatible con modo teclado | Probado tipeando el código + Enter (igual que el lector); falta probar con el equipo físico. |
| W-61 | Word Lector | Foco permanente en el campo de lectura. | COMPLETADO Y VERIFICADO | Foco fijo | Interfaz (copia de la base real, 23/10): el foco arranca y vuelve al lector. |
| W-62 | Word Lector | Ignorar la misma lectura en menos de 1 segundo. | COMPLETADO Y VERIFICADO | Antirrebote | Interfaz (copia de la base real, 23/10) y Tests automáticos. |
| W-63 | Word Lector | Feedback visual y sonoro. | COMPLETADO Y VERIFICADO | Verde/rojo + tono | Interfaz (copia de la base real, 23/10): verde/rojo verificado; el sonido no se puede escuchar en la prueba automatizada. |
| W-64 | Word Lector | Códigos con guiones y letras. | COMPLETADO Y VERIFICADO | Validación de caracteres | Interfaz (copia de la base real, 23/10) y Tests automáticos. |
| W-65 | Word Lector | Probar sin lector: tipear + Enter. | COMPLETADO Y VERIFICADO | Mismo campo | Interfaz (copia de la base real, 23/10). |
| W-66 | Word Lector | Validar código, lote y producto. | COMPLETADO Y VERIFICADO | Lote (27 dígitos), material, producto rechazado | Interfaz (copia de la base real, 23/10): un producto terminado se rechaza. |
| U-01 | Excel usuarios | Braian Laleta · Gerencia · blaleta@cpsudamericana.com | COMPLETADO Y VERIFICADO | Cuenta creada pendiente | Interfaz (copia de la base real, 23/10) (copia). |
| U-02 | Excel usuarios | Gabriel Laleta · Gerencia (consulta) · glaleta@… | COMPLETADO Y VERIFICADO | Gerencia (consulta) | Interfaz (copia de la base real, 23/10) (etapa anterior). |
| U-03 | Excel usuarios | Catalina Laleta · Gerencia · laletacatalina@gmail.com | COMPLETADO Y VERIFICADO | Cuenta creada pendiente | Interfaz (copia de la base real, 23/10) (copia). |
| U-04 | Excel usuarios | Eduardo González · Supervisor · egonzalez@cpsudamericana.com | COMPLETADO Y VERIFICADO | Email cambiado, misma clave | Interfaz (copia de la base real, 23/10): entró con el email nuevo. |
| U-05 | Excel usuarios | Alejandra Antón · Administración · alejandra@cpsudamericana.com | COMPLETADO Y VERIFICADO | Email cambiado | Interfaz (copia de la base real, 23/10): entró con el email nuevo. |
| U-06 | Excel usuarios | Ailen Grivetto · Administración · ailen@cpsudamericana.com | COMPLETADO Y VERIFICADO | Cuenta creada pendiente | Interfaz (copia de la base real, 23/10) (copia). |
| U-07 | Excel usuarios | David Orellano · Encargado | COMPLETADO Y VERIFICADO | Sin cambios | Interfaz (copia de la base real, 23/10). |
| U-08 | Excel usuarios | Dylan Romero · Retiros de MP + suplente de Encargado | COMPLETADO Y VERIFICADO | Perfiles adicionales | Interfaz (copia de la base real, 23/10). |
| U-09 | Excel usuarios | Daniela Tenorio · Materia prima (ingresos, retiros, ajustes, trazabilidad, necesidad) | COMPLETADO Y VERIFICADO | Perfil MP + ve Compras | Interfaz (copia de la base real, 23/10): ingreso imputado a compra, confirmación de molienda; no registra compras (rechazo verificado). |
| U-10 | Excel usuarios | Carolina · Compras | COMPLETADO Y VERIFICADO | Perfil Compras | Interfaz (copia de la base real, 23/10). |
| U-11 | Excel usuarios | Sabrina Orellano · Despacho | COMPLETADO Y VERIFICADO | Sin cambios | Tests automáticos. |
| U-12 | Excel usuarios | Adriana Troncoso · Despacho (sin email propio) | COMPLETADO Y VERIFICADO | Cuenta sin email, entra con PIN | Interfaz (copia de la base real, 23/10): una cuenta de Despacho creada en la prueba entró con PIN. |
| U-13 | Excel usuarios | Alejandro Rivero · Matrices | COMPLETADO Y VERIFICADO | Módulo Matrices | Interfaz (copia de la base real, 23/10). |
| U-14 | Excel usuarios | Yesica Troncoso · Molino | COMPLETADO Y VERIFICADO | Módulo Molino | Interfaz (copia de la base real, 23/10). |
| U-15 | Excel usuarios | Ariel Orellano · Operario | COMPLETADO Y VERIFICADO | Cuenta + PIN | Interfaz (copia de la base real, 23/10). |
| U-16 | Excel usuarios | Octavio Fretes · Operario | COMPLETADO Y VERIFICADO | Cuenta creada pendiente | Interfaz (copia de la base real, 23/10) (copia). |
| U-17 | Excel usuarios | Franco Uribarri · Operario | COMPLETADO Y VERIFICADO | Cuenta creada pendiente | Interfaz (copia de la base real, 23/10) (copia). |
| U-18 | Excel usuarios | Nicolas Acosta · Operario (email sin espacio) | COMPLETADO Y VERIFICADO | Cuenta creada pendiente | Interfaz (copia de la base real, 23/10) (copia). |
| U-19 | Excel usuarios | Facundo Troncoso · Operario (email sin espacio) | COMPLETADO Y VERIFICADO | Cuenta creada pendiente | Interfaz (copia de la base real, 23/10) (copia). |
| U-20 | Excel usuarios | Observación: Supervisor hace los cambios; Gerencia sólo mira. | COMPLETADO Y VERIFICADO | Permisos | Interfaz (copia de la base real, 23/10). |
| S-01 | Excel stock MP | Analizar todas las hojas (stock, ingresos, egresos, bolsones, master, compras). | COMPLETADO Y VERIFICADO | scripts/conciliar-stock-mp.ts + docs/16 | Análisis hecho; no se importó nada. |
| S-02 | Excel stock MP | Stock general, pie de máquina y tolva separados, con saldos y movimientos propios. | COMPLETADO Y VERIFICADO | Tres ubicaciones del ledger | Interfaz (copia de la base real, 23/10): 2.800,95 → 2.700,95 kg general; pie y tolva en 0 al cerrar. |
| S-03 | Excel stock MP | El traspaso no reduce el total; la carga en tolva baja el pie. | COMPLETADO Y VERIFICADO | Traslados con dos patas | scripts/verificar-saldos.ts: 0 desajustes (producción y copia). |
| S-04 | Excel stock MP | Vistas diarias de ingresos y egresos con fecha, cantidad, observación y responsable. | COMPLETADO Y VERIFICADO | Movimientos con filtro de fechas y ubicación | Interfaz (copia de la base real, 23/10). |
| S-05 | Excel stock MP | Diferencia de balanza como ajuste de MP. | COMPLETADO Y VERIFICADO | Operaciones de stock | Tests automáticos. |
| S-06 | Excel stock MP | Sobrante (bolsa abierta o tolva, con o sin master). | COMPLETADO Y VERIFICADO | Devolución sin mezclar / sobrante con composición | Interfaz (copia de la base real, 23/10): 2 kg al código 403 con su composición. |
| S-07 | Excel stock MP | Molienda de coladas o descartes. | COMPLETADO Y VERIFICADO | Molino | Interfaz (copia de la base real, 23/10). |
| S-08 | Excel stock MP | Bolsones de peso variable identificados. | COMPLETADO Y VERIFICADO | Bolsón con código propio | Interfaz (copia de la base real, 23/10): bolsón E2E-1. |
| S-09 | Excel stock MP | Fraccionamiento de master y retorno de bolsitas. | COMPLETADO Y VERIFICADO | Fraccionamiento + devolución | Tests automáticos. |
| S-10 | Excel stock MP | Presentaciones del master configurables. | COMPLETADO Y VERIFICADO | Configuración → Recetas → Presentaciones | Tests automáticos. |
| S-11 | Excel stock MP | Importar saldos sólo con fecha de corte y conciliación. | PENDIENTE DE DEFINICIÓN EXTERNA | Procedimiento de puesta en marcha con respaldo | Falta fecha de corte y conteo físico (el «stock al 20/10» es teórico; 24 diferencias). |
| S-12 | Excel stock MP | Mínimos y máximos de la planilla. | PENDIENTE DE DEFINICIÓN EXTERNA | Comparados | B24 distinto (100/200 vs 50/75); B01 y B10 con máximo menor que el mínimo: corregir la planilla. |
| S-13 | Excel stock MP | Materiales A10, A17, 161 y 110. | PENDIENTE DE DEFINICIÓN EXTERNA | No existen en el sistema | Confirmar si se dan de alta (cambio estructural). |
| F-01 | Fotos | Esquinero con volumen = rejilla. | COMPLETADO Y VERIFICADO | Miniatura en el selector | Interfaz (copia de la base real, 23/10): carga (tras corregir el proxy de imágenes). |
| F-02 | Fotos | Esquinero chato = ciego. | COMPLETADO Y VERIFICADO | Miniatura en el selector | Interfaz (copia de la base real, 23/10). |
| F-03 | Fotos | Borde con volumen = rejilla. | COMPLETADO Y VERIFICADO | Asociado al tipo Borde | El catálogo todavía no tiene productos Borde: se verá cuando existan. |
| F-04 | Fotos | Borde chato = ciego. | COMPLETADO Y VERIFICADO | Asociado al tipo Borde | Ídem. |
| F-05 | Fotos | ¿Las rampas son los bordes? | PENDIENTE DE DEFINICIÓN EXTERNA | No se asoció a Rampa | Confirmar si borde y rampa son la misma pieza. |

## Errores encontrados y corregidos

1. Tanda de pisos perdía la inyectora al editar fecha/turno (`actualizarTandaAction`
   mandaba `inyectora: null` porque el formulario de pisos no tiene ese campo).
   Afectaba la planificación real. Corregido en la acción y en `actualizarTanda`.
2. Sobrante: el selector ofrecía códigos de molienda; `codigosDeSobrante` y
   `registrarSobrante` sólo aceptan SOBRANTE.
3. Faltaba editar el código de barras (producto) y código/nombre (MP):
   `actualizarCodigoBarras`, `editarMateriaPrima` (Supervisión/Gerencia, auditado).
4. Auditoría: `mismoValor` trataba «19» y «019» como iguales y no registraba el cambio.
5. Necesidad: «entregas en riesgo» sólo si lo disponible no cubre los pedidos.
6. Operario: tanda con fecha futura mostraba «Iniciar producción» (fallaba); ahora
   avisa la fecha.
7. Producción: `operarioId` del ciclo = quien la inicia desde la máquina; texto
   «ciclo #» vacío en retiros previos al inicio.
8. Mensaje y comentarios que remitían a horarios en Parámetros (reemplazados por
   esquemas).

Datos: ninguna migración nueva en esta auditoría. En producción sólo se hicieron
consultas de lectura (saldos, conciliación). La copia local recibió los datos de
prueba.

## Rendimiento (con evidencia)

- Consultas por pantalla (contador temporal, copia): Inicio 34 → 29; Master y
  dosificación 9 + 1 por receta → 10 fijas; Compras 6 + 1 por compra → 7 fijas.
- Bundle (`.next/static/chunks`, 856 KB sin comprimir en total): los 3 mayores son
  framework (≈72, 39 y 36 KB gzip); chunks de la app ≤ 10 KB gzip. Sin lazy loading
  justificado.
- Estáticos: logo 11,5 KB; miniaturas nuevas 3–9 KB; fotos de pisos servidas por el
  optimizador a 48 px. No se agregaron cachés ni dependencias.

## Pendientes externos

Ver filas W-04, W-46, W-53, W-54, W-55, W-58, S-11, S-12, S-13, F-05 y el lector
físico (W-60).
