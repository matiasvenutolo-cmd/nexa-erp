# Minuta 15/10/2026 — Rediseño de usabilidad, planificación y stock de MP

Fuente: minuta "NEXA – Mejoras al sistema de Producción y Stock" (15/10/2026) y
referencia visual Nexa Soluciones (nexa-solciones.vercel.app). Este documento
registra qué se cambió, con qué reglas, y las asunciones tomadas para avanzar
(regla 1 de AGENTS.md), cada una como pregunta abierta.

## 1. Diseño y navegación

- Identidad de Nexa Soluciones en tokens (`src/app/globals.css`): Outfit
  (títulos) + Manrope (texto), azul #002094, naranja #ee7d30 para la acción
  principal, fondo #eef1f6, paneles blancos con título en bloque, franja de
  marca azul/naranja, botones `.btn/.btn-primary/.btn-outline`, tablas
  `.tabla`, estadísticas `.stat-card`. Sin segunda aplicación: las pantallas
  existentes toman los tokens.
- Menú por áreas (`src/lib/nav.ts`): Ventas (Pedidos, Stock de productos,
  Clientes, Reclamos), Fábrica (Producción, Materia prima, Trazabilidad),
  Administración (Usuarios, Parámetros, Configuración, Historial de cambios).
- Inicio por rol: Operario → Mi turno (`/taller`, sin menú); Materia prima →
  Materia prima (sin pedidos ni producción); Encargado → Producción; resto →
  Inicio.
- Mensajes de resultado en cada acción (`FormAccion`): qué pasó y qué sigue;
  botón deshabilitado mientras guarda; clave anti-repetición.

## 2. Planificación (`src/lib/data/planificacion.ts`)

- Grupos por producto (= familia + tipo + color + proveedor del master) con
  pedido, stock, cubierto, faltante, planificado y por planificar. La
  cobertura es la misma de pedidos.
- Tandas (`tanda`, `tanda_pedido`): pedidos elegidos + extra para stock, o
  sólo stock. Un renglón no puede planificarse dos veces (se valida contra lo
  que falta planificar).
- Secuencia manual (subir/bajar), postergar con motivo, cortar (quitar
  pedidos, vuelven a "por planificar"), cancelar, asignar inyectora/fecha/
  turno, receta de arranque.
- Avisos: cambio de matriz (familia + tipo) y de color respecto de la tanda
  anterior de la misma inyectora; entrega comprometida vencida/hoy/mañana/≤7
  días; falta de material; sin receta.
- Inicio de producción desde la tanda: continúa la partida abierta del
  producto si no tiene producción en curso; precarga pedidos y objetivo.
- Necesidad de compra: material de la secuencia (receta × cargas) contra
  depósito + pie de máquina, acumulado en el orden de la secuencia.
- **Orden por defecto: fecha de ingreso** (`ordenPrioridad`), urgencia de
  Ventas primero. Reemplaza el orden por fecha de entrega; la entrega se
  controla con alertas.

## 3. Recetas de carga (`src/lib/data/recetas.ts`)

- `presentacion_mp`: bolsa 25 kg (virgen), bolsitas 600 g y 750 g (master);
  generales por tipo o propias de un material.
- `receta_carga` (+ ítems) por producto: RÉGIMEN y ARRANQUE. Cantidades en
  presentaciones enteras o medias. Conversión exacta en gramos.
- **No se calcula desde `dosificacion_master` (g/kg)**: ver §8.

## 4. Operario y relevo (`src/lib/data/taller.ts`, `/taller`)

- Tomar turno (Mañana/Tarde/Noche, nombre si la cuenta es compartida, golpes
  heredados del relevo). Si hay turno anterior, recepción obligatoria:
  coincide / diferencia con motivo de lista (queda como novedad).
- Cargar la receta con un toque: toma los kg del pie de máquina de la
  inyectora (líneas de retiro abiertas, primero las más viejas); todo o nada.
  Carga distinta: + / − (medias bolsas) y motivo obligatorio; queda lo
  planificado y lo cargado.
- "No pude cargar" con motivo; lectura del código de la bolsa (confirma
  material, lote y certificado contra la receta).
- Cierre de turno: golpes y descarte en kg; piezas = golpes × piezas por
  golpe. Cierre de producción: piezas a stock = producidas − descarte (kg ÷
  peso por pieza); rebarba y scrap en kg opcionales; colada automática si el
  producto tiene `colada_kg_por_golpe`.

## 5. Materia prima por ubicación (`src/lib/data/ubicaciones.ts`)

- Ubicaciones del ledger: "NEXA" (depósito), "Pie de máquina", "Tolva / en
  proceso". Migración 0009 crea las dos nuevas en cero.
- Retiro = traslado depósito → pie; carga = pie → tolva; devolución = pie →
  depósito (reutilizable); sobrante = sale de la tolva (proporcional a lo
  cargado) y entra con su código; diferencia al cerrar el retiro = ajuste del
  pie; consumo = salida de la tolva al cerrar la producción. El total físico
  no cambia con los traslados.
- Sobrante de una producción ya cerrada: entra al depósito y corrige el
  consumo ya registrado (no hay nada en tolva).
- Correcciones de Supervisión/Gerencia revierten el traslado correcto (y
  siguen funcionando con los registros anteriores al circuito).
- Vista de Materia prima: stock por ubicación, movimientos día por día,
  pie de máquina, lotes (lote de MP / lote del proveedor / partida NEXA),
  ajustes: diferencia de balanza, molienda en bolsones (lote con código
  interno 99999999), fraccionamiento de master (no cambia kg), alta de
  materiales (Supervisión/Gerencia).
- Cantidades escritas a mano con convención argentina ("1.500" = 1500) y
  alerta, sin bloqueo, ante cantidades fuera de rango (mediana de ingresos ±
  ×10, o menos de una bolsa sin historial).

## 6. Bugs de la demo

| Bug | Causa encontrada | Corrección |
|---|---|---|
| Pantalla inesperada al crear pedido | N° de orden único → error de base sin manejar; botón sin bloqueo (doble envío) | Validación previa con mensaje; botón deshabilitado al guardar; pantalla de error amable en `(shell)/error.tsx` |
| Volver desde una producción lleva a Materia prima | El retiro hecho desde la producción redirigía al retiro; "volver" fijo a Materia prima | Redirige a la producción con mensaje; "volver" según origen |
| La navegación vuelve a una pantalla anterior | Mismo patrón de redirecciones | Ídem; acciones de máquina sin redirección (resultado en la misma pantalla) |
| Pedido "Entregado" que vuelve a "En armado" | Estado asignado a mano en cuatro lugares; confusión entre estado del despacho y del pedido | `recalcularEstadoPedido`: estado derivado de renglones y despachos; ENTREGADO no vuelve atrás |
| Picking: ¿baldosas o cajas? | La cantidad son baldosas/unidades, sin aclarar | Rótulos y ayuda explícitos |
| Datos viejos ensucian | Pedidos del Excel sin producto | Archivado reversible (Supervisión/Gerencia) y script de arranque |

## 7. Permisos (`src/lib/auth/permisos.ts`)

- Cambios estructurales y correcciones: Supervisor y Gerencia
  (`ROLES_ESTRUCTURA`): alta de productos y colores, alta de materiales,
  resolución de reclamos, correcciones de producción/MP, archivado.
- Prioridad de pedidos (urgente/adelantado/postergado): Administración
  (ventas), Encargado, Supervisor, Gerencia.
- Planificación y recetas: Encargado, Supervisor, Gerencia.
- Operación de máquina: Operario + Encargado, Supervisor, Gerencia.
- Ajustes de MP (balanza, molienda, fraccionamiento): Materia prima,
  Supervisor, Gerencia.
- "Informar un error": todos los demás roles; llega a Supervisión.

## 8. Preguntas abiertas (responde: Gerencia CPS / gerente de producción)

1. **Master: única fuente de verdad.** `dosificacion_master` dice 0,015 g/kg
   (rejilla) y 0,012 (negro); la planilla de tolva registra 1,2 kg de master
   negro cada 100 kg (12 g/kg) y 1,5 kg de gris claro en el arranque (15 g/kg).
   Se conservaron los valores anteriores sin uso para la carga y se cargan
   recetas en bolsas. Confirmar recetas por color y si se elimina la
   dosificación en g/kg.
2. Presentaciones: bolsa de 25 kg de copolímero y bolsitas de 600/750 g son
   las de la minuta; confirmar otras (150 g histórica, bolsones).
3. Turnos: se usan Mañana/Tarde/Noche sin horario (se registra la hora real).
   Confirmar nombres y horarios.
4. Cambio de matrices: no hay regla; la planificación avisa el cambio y se
   ordena a mano. Definir en qué turnos se puede cambiar matriz.
5. Descarte: se pide en kg (minuta) y se convierte a piezas con el peso por
   pieza. Confirmar si el descarte del piso se pesa o se cuenta.
6. Colada por golpe: dato por producto, vacío hasta que se cargue (sin dato
   no se calcula).
7. Alerta de entrega: ventana de 7 días. Confirmar.
8. Orden por defecto por fecha de ingreso (minuta) en lugar de fecha de
   entrega (definición anterior). Confirmar.
9. Archivado de 11 pedidos abiertos sin producto (Excel viejo): confirmar con
   Ventas que no siguen vigentes antes del arranque.
10. Consumo: se registra al cerrar la producción (lo que queda en tolva al
    cerrar se considera consumido salvo que se baje como sobrante).

## 9. Fuera de alcance de esta etapa

- Indicadores gerenciales (última etapa de la minuta).
- Integración del Excel de tiempos y Gantt.
- Calendario/regla de cambios de matriz (pendiente de definición).
- Importación del Excel de stock de Materia prima: se usa como referencia; los
  saldos se fijan con el conteo del arranque (docs/14), no por importación.
- Etiquetas impresas (R5).
