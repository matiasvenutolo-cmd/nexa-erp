/**
 * NEXA — modelo de datos.
 *
 * Fuente de verdad del esquema. El porqué de cada decisión está en
 * docs/02-modelo-datos.md, justificado contra los hallazgos de docs/01-analisis.md.
 *
 * Dos reglas que atraviesan todo el archivo:
 *
 *  1. El ledger (`movimiento`) es la verdad del stock. `saldo` es caché reconciliable.
 *     Nunca se escribe un saldo sin su movimiento, y van en la misma transacción.
 *  2. Toda mutación registra quién y cuándo.
 *
 * Las tablas estructurales nacen con todas sus columnas aunque sus consumidores
 * lleguen en releases posteriores (ver docs/02-modelo-datos.md §7): agregar
 * `depositoId` o `usuarioId` después obliga a reescribir el histórico.
 */

import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
  pgSequence,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/** Los 8 roles del procedimiento firmado, más gerencia y operario (análisis §3.10). */
export const rolEnum = pgEnum("rol", [
  "GERENCIA",
  "SUPERVISOR",
  "ADMINISTRACION",
  "ENCARGADO",
  "MATERIA_PRIMA",
  "RETIROS_MP",
  "MATRICES",
  "MOLINO",
  "DESPACHO",
  "OPERARIO",
]);

export const familiaEnum = pgEnum("familia", ["REJILLA", "CIEGO"]);

/** UNICO/TRAMA/MONEDA son pisos; BORDE/ESQUINERO/RAMPA son accesorios. */
export const tipoProductoEnum = pgEnum("tipo_producto", [
  "UNICO",
  "TRAMA",
  "MONEDA",
  "BORDE",
  "ESQUINERO",
  "RAMPA",
]);

/** MOLIENDA y SOBRANTE no son categorías sueltas: son el resultado de las
 *  transformaciones del análisis §3.5. */
export const tipoMpEnum = pgEnum("tipo_mp", [
  "VIRGEN",
  "MASTER",
  "MOLIENDA",
  "SOBRANTE",
  "MUESTRA",
]);

export const tipoMovimientoEnum = pgEnum("tipo_movimiento", [
  "ENTRADA",
  "SALIDA",
  "AJUSTE",
  "TRANSFERENCIA",
  "TRANSFORMACION",
]);

/** Qué hecho del negocio causó el movimiento. Permite reconstruir el porqué de
 *  cada kilo sin mirar otra tabla. */
export const origenMovimientoEnum = pgEnum("origen_movimiento", [
  "IMPORTACION",
  "CICLO",
  "PEDIDO",
  "INVENTARIO",
  "TRANSFORMACION",
  "INGRESO_MP",
  "RETIRO_MP",
  "DEVOLUCION",
  "MANUAL",
  // Minuta 15/10: el stock de MP se separa por ubicación (depósito, pie de
  // máquina, tolva/en proceso) y suma sus variantes.
  "CARGA_TOLVA",
  "CONSUMO",
  "DIFERENCIA_BALANZA",
  "MOLIENDA",
]);

/**
 * El estado no es lineal: el cliente pidió despacho parcial ("se lleva los pisos
 * y quedan las rampas para la semana que viene"), así que un pedido puede estar
 * parcialmente despachado y seguir abierto.
 */
export const estadoPedidoEnum = pgEnum("estado_pedido", [
  "PEDIDO",
  "EN_ARMADO",
  "LISTO_PARA_DESPACHAR",
  "PARCIALMENTE_DESPACHADO",
  "ENTREGADO",
  "CANCELADO",
]);

export const estadoReservaEnum = pgEnum("estado_reserva", [
  "ABIERTA",
  "CONSUMIDA",
  "LIBERADA",
]);

export const estadoCajaEnum = pgEnum("estado_caja", [
  "EN_STOCK",
  "ARMADA",
  "DESPACHADA",
  "BAJA",
]);

export const estadoInventarioEnum = pgEnum("estado_inventario", ["ABIERTO", "CERRADO"]);

/** Los dos controles que pidió el cliente: al pasar a despacho y en el control final. */
export const tipoPiqueoEnum = pgEnum("tipo_piqueo", ["ARMADO", "CONTROL_FINAL"]);

/** Los 4 casos del circuito de devoluciones del procedimiento (análisis §3.11). */
export const motivoDevolucionEnum = pgEnum("motivo_devolucion", [
  "DIRECCION_ERRONEA",
  "MERCADERIA_ERRONEA",
  "MERCADERIA_FALLADA",
  "MATERIAL_DEFECTUOSO",
]);

/** Un despacho (entrega total o parcial) recorre: armado → primer control →
 *  control final y entrega. ANULADO si se cancela antes de entregar. */
export const estadoDespachoEnum = pgEnum("estado_despacho", ["ARMANDO", "CONTROLADO", "ENTREGADO", "ANULADO"]);

export const estadoReclamoEnum = pgEnum("estado_reclamo", ["ABIERTO", "EN_ANALISIS", "CERRADO"]);

export const tipoAvisoEnum = pgEnum("tipo_aviso", ["PEDIDO_LISTO", "RECLAMO_NUEVO", "INFORME_RECLAMO", "ERROR_INFORMADO"]);

/** Retiro de materia prima a pie de máquina: abierto mientras quede material
 *  sin cargar, devolver o justificar (puede durar varios turnos). */
export const estadoRetiroEnum = pgEnum("estado_retiro", ["ABIERTO", "CERRADO"]);

/**
 * Lo que pasa con el material después de retirarlo del depósito:
 *  CARGA_TOLVA  se carga físicamente en la máquina (sale de pie de máquina);
 *  DEVOLUCION   vuelve al depósito sin mezclar (sale de pie de máquina);
 *  SOBRANTE     material ya mezclado con master que se saca de la tolva y entra
 *               al depósito con su código de sobrante/molienda;
 *  DIFERENCIA   faltante o sobrante de balanza justificado al cerrar el retiro.
 */
export const tipoMovimientoMaquinaEnum = pgEnum("tipo_movimiento_maquina", ["CARGA_TOLVA", "DEVOLUCION", "SOBRANTE", "DIFERENCIA"]);

/** Receta de carga en tolva: la normal de producción y la inicial reforzada que
 *  se usa al arrancar después de un cambio de color (minuta 15/10). */
export const tipoRecetaEnum = pgEnum("tipo_receta", ["REGIMEN", "ARRANQUE"]);

/** Turnos de la planta (triple turno). Los horarios no están definidos: el
 *  sistema registra la hora real de inicio y de cierre de cada turno. */
export const turnoEnum = pgEnum("turno", ["MANANA", "TARDE", "NOCHE"]);

/** Tanda planificada: producto + color + cantidad, con sus pedidos. */
export const estadoTandaEnum = pgEnum("estado_tanda", ["PLANIFICADA", "EN_CURSO", "COMPLETADA", "POSTERGADA", "CANCELADA"]);

export const estadoTurnoEnum = pgEnum("estado_turno", ["ABIERTO", "CERRADO"]);

/** Hechos de la máquina que no mueven stock pero hay que dejar registrados. */
export const tipoEventoProduccionEnum = pgEnum("tipo_evento_produccion", ["INICIO", "PAUSA", "REANUDACION", "CANCELACION", "FINALIZACION"]);

export const tipoNovedadEnum = pgEnum("tipo_novedad", ["NO_CARGA", "CARGA_DISTINTA", "DIFERENCIA_RELEVO", "INTERRUPCION"]);

export const condicionIvaEnum = pgEnum("condicion_iva", [
  "RESPONSABLE_INSCRIPTO",
  "MONOTRIBUTO",
  "EXENTO",
  "CONSUMIDOR_FINAL",
]);

// ---------------------------------------------------------------------------
// Identidad y acceso
// ---------------------------------------------------------------------------

/**
 * Personas reales del organigrama (análisis §3.10).
 *
 * Dos formas de entrar, como en REINER: administración/supervisión/gerencia con
 * email + contraseña; los operarios de planta con PIN, porque entran desde la PC
 * de inyectora con las manos ocupadas.
 *
 * `puedeVerPrecios` NO es columna: sale del rol. La regla del cliente es "de
 * supervisor para abajo nadie ve precios" y vive en src/lib/auth/permisos.ts,
 * para que no pueda quedar desincronizada fila por fila.
 */
export const usuario = pgTable(
  "usuario",
  {
    id: serial("id").primaryKey(),
    nombre: text("nombre").notNull(),
    email: text("email").unique(),
    passwordHash: text("password_hash"),
    pinHash: text("pin_hash"),
    rol: rolEnum("rol").notNull(),
    activo: boolean("activo").notNull().default(true),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("usuario_rol_idx").on(t.rol)],
);

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

/**
 * Existe como entidad porque el proveedor forma parte de la IDENTIDAD del
 * producto (análisis §3.1): el procedimiento lo justifica en "la diferencia de
 * brillos y tonos de color entre los distintos proveedores". Mismo color de dos
 * proveedores = dos SKUs que no son intercambiables.
 */
export const proveedorMaster = pgTable("proveedor_master", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  inicial: text("inicial").notNull().unique(), // B = Berma, A = Arcolor, P = Platsur
});

/**
 * Tabla propia, no string. Resuelve de raíz el "Azul Oscuro" / "azul oscuro" /
 * "AZUL OSCURO" de los Excel: `clave` es el nombre normalizado (minúsculas,
 * sin acentos, espacios colapsados), calculado por Postgres y único. La misma
 * normalización vive en `claveColor()` (src/lib/catalogo-normalizacion.ts).
 *
 * `oficial` = está en la lista oficial que mandó el cliente (data/codigos.xlsx,
 * hoja "colores"). `especial` = color a pedido de un cliente, registrado para
 * poder repetirlo: guarda solicitante, proveedor y master.
 */
export const color = pgTable(
  "color",
  {
    id: serial("id").primaryKey(),
    nombre: text("nombre").notNull().unique(),
    /** Muestra del color para elegirlo en el pedido (paleta del cliente). */
    hex: text("hex"),
    clave: text("clave").generatedAlwaysAs(
      sql`lower(regexp_replace(btrim(translate(nombre, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu')), '\\s+', ' ', 'g'))`,
    ),
    iniciales: text("iniciales").notNull().unique(), // NE, AO, AC, GO, GC...
    oficial: boolean("oficial").notNull().default(false),
    especial: boolean("especial").notNull().default(false),
    /** Solicitante del color especial. */
    clienteId: integer("cliente_id").references(() => cliente.id),
    proveedorMasterId: integer("proveedor_master_id").references(() => proveedorMaster.id),
    /** Nombre/código del master tal como lo identifica el proveedor ("24B-Master Negro 951"). */
    masterNombre: text("master_nombre"),
    masterCodigo: text("master_codigo"),
    /** El ítem de materia prima del master, cuando ya existe en el inventario. */
    masterMateriaPrimaId: integer("master_materia_prima_id").references(() => materiaPrima.id),
    observaciones: text("observaciones"),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    creadoPorId: integer("creado_por_id").references(() => usuario.id),
  },
  (t) => [uniqueIndex("color_clave_uq").on(t.clave)],
);

/**
 * Los ~95 SKUs.
 *
 * `codigo` (001B-PR-NE) se DERIVA de numero + inicial del proveedor + código del
 * tipo + iniciales del color, en construirCodigoProducto() (src/lib/data/catalogo.ts).
 * Nunca se tipea a mano. No es columna generada de Postgres porque los componentes
 * viven en otras tablas; la unicidad la garantiza el índice de abajo.
 */
export const producto = pgTable(
  "producto",
  {
    id: serial("id").primaryKey(),
    numero: text("numero").notNull(), // "001", "075"
    codigo: text("codigo").notNull().unique(), // derivado: "001B-PR-NE"
    /** Código de barras de la lista oficial del cliente (data/codigos.xlsx:
     *  "001B-RU-NE"). Usa otra nomenclatura que `codigo` — ver
     *  docs/08-configuracion-y-panel-admin.md §inconsistencias. */
    codigoBarras: text("codigo_barras"),
    descripcion: text("descripcion").notNull(),

    familia: familiaEnum("familia").notNull(),
    tipo: tipoProductoEnum("tipo").notNull(),
    tipoCodigo: text("tipo_codigo").notNull(), // "PR" (piso rejilla), "PM", "PT"...
    colorId: integer("color_id")
      .notNull()
      .references(() => color.id),
    proveedorMasterId: integer("proveedor_master_id").references(() => proveedorMaster.id),

    // Datos físicos — valores reales en docs/01-analisis.md §3.9
    m2PorUnidad: numeric("m2_por_unidad", { precision: 8, scale: 4 }), // 0,16
    kgPorUnidad: numeric("kg_por_unidad", { precision: 8, scale: 4 }), // 0,610
    piezasPorGolpe: integer("piezas_por_golpe"), // piso 1 · rampa 2 · ángulo 4
    /** Excepción por producto. Null = regla general: pisos usan el parámetro
     *  `unidades_por_caja_pisos`; los accesorios no se embalan hasta la venta. */
    unidadesPorCaja: integer("unidades_por_caja"),
    pesoCajaKg: numeric("peso_caja_kg", { precision: 8, scale: 3 }),
    /** Colada por golpe (kg): "el recorrido hasta la pieza pesa siempre lo
     *  mismo, así que se calcula por fórmula" (minuta 15/10). Sin dato no se
     *  calcula. */
    coladaKgPorGolpe: numeric("colada_kg_por_golpe", { precision: 8, scale: 4 }),
    /** Si el producto admite sobrante/molienda como materia prima en su receta.
     *  Lo define el Encargado; sin definición validada queda desactivado. */
    aceptaSobrante: boolean("acepta_sobrante").notNull().default(false),

    // Configurables desde el Panel Admin (cada cambio queda en auditoria_config).
    minimo: integer("minimo"),
    maximo: integer("maximo"),

    esAccesorio: boolean("es_accesorio").notNull().default(false),
    activo: boolean("activo").notNull().default(true),
    observaciones: text("observaciones"),
  },
  (t) => [
    index("producto_familia_tipo_idx").on(t.familia, t.tipo),
    // La identidad real del SKU: mismo tipo y color de distinto proveedor son
    // productos distintos (§3.1).
    unique("producto_identidad_uq").on(t.familia, t.tipo, t.colorId, t.proveedorMasterId),
  ],
);

export const materiaPrima = pgTable("materia_prima", {
  id: serial("id").primaryKey(),
  codigoInterno: text("codigo_interno").notNull().unique(), // "3", "31", "B1", "P11"
  nombre: text("nombre").notNull(),
  tipo: tipoMpEnum("tipo").notNull(),
  unidad: text("unidad").notNull().default("kg"),
  proveedor: text("proveedor"),
  minimo: numeric("minimo", { precision: 12, scale: 3 }),
  maximo: numeric("maximo", { precision: 12, scale: 3 }),
  activo: boolean("activo").notNull().default(true),
  observaciones: text("observaciones"),
});

/**
 * El BOM. Rejilla lleva un componente (100% Copolímero 2240P); Ciego lleva dos
 * (50/50 Copolímero 2630PC + Plastomer).
 *
 * El master NO va acá: se calcula como ratio sobre el total de materia prima
 * porque depende del color, no del producto (análisis §3.9).
 *
 * Se CARGA en R4, pero la tabla existe desde R1 para que el cálculo de faltante
 * de R2 evolucione sin migración.
 */
export const recetaProducto = pgTable(
  "receta_producto",
  {
    id: serial("id").primaryKey(),
    productoId: integer("producto_id")
      .notNull()
      .references(() => producto.id, { onDelete: "cascade" }),
    materiaPrimaId: integer("materia_prima_id")
      .notNull()
      .references(() => materiaPrima.id),
    porcentaje: numeric("porcentaje", { precision: 6, scale: 3 }).notNull(), // 100.000 / 50.000
  },
  (t) => [unique("receta_producto_uq").on(t.productoId, t.materiaPrimaId)],
);

/**
 * Dosificación de master: kg de master por kg de materia prima base.
 *
 * Una fila con `colorId` null es el valor base de la familia (REJILLA, CIEGO);
 * una fila con color es la excepción para ese color (REJILLA + Negro). Se
 * resuelve con `resolverDosificacion()` (src/lib/data/dosificacion.ts):
 * excepción del color si existe, si no el valor base. Nada de esto vive en
 * el código: se edita desde el Panel Admin.
 *
 * Unidad: g/kg (`g_por_kg_mp`), definición del cliente del 05/10/2026.
 */
export const dosificacionMaster = pgTable(
  "dosificacion_master",
  {
    id: serial("id").primaryKey(),
    familia: familiaEnum("familia").notNull(),
    colorId: integer("color_id").references(() => color.id),
    /** La materia prima base sobre la que se dosifica (Copolímero 2240P en rejilla). */
    materiaPrimaBaseId: integer("materia_prima_base_id").references(() => materiaPrima.id),
    /** Gramos de master por kg de materia prima (definición del cliente, 05/10/2026). */
    gPorKgMp: numeric("g_por_kg_mp", { precision: 10, scale: 5 }).notNull(),
    observaciones: text("observaciones"),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadoPorId: integer("actualizado_por_id").references(() => usuario.id),
  },
  (t) => [unique("dosificacion_master_uq").on(t.familia, t.colorId).nullsNotDistinct()],
);

// ---------------------------------------------------------------------------
// Configuración (Panel Admin)
// ---------------------------------------------------------------------------

/**
 * Parámetros globales que cambian con el negocio y no deben vivir en el
 * código. Las claves válidas están en `PARAMETROS` (src/lib/data/parametros.ts).
 */
export const parametro = pgTable("parametro", {
  clave: text("clave").primaryKey(),
  valor: numeric("valor", { precision: 14, scale: 4 }).notNull(),
  descripcion: text("descripcion").notNull(),
  unidad: text("unidad"),
  actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  actualizadoPorId: integer("actualizado_por_id").references(() => usuario.id),
});

/**
 * Historial de cambios de configuración: mínimos/máximos, master, colores,
 * parámetros, usuarios y prioridad de pedidos. Una fila por campo cambiado,
 * con el valor anterior y el nuevo. Nunca se edita ni se borra.
 */
export const auditoriaConfig = pgTable(
  "auditoria_config",
  {
    id: serial("id").primaryKey(),
    entidad: text("entidad").notNull(), // "producto", "materia_prima", "color", ...
    entidadId: text("entidad_id").notNull(),
    campo: text("campo").notNull(),
    valorAnterior: text("valor_anterior"),
    valorNuevo: text("valor_nuevo"),
    motivo: text("motivo"),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuario.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("auditoria_config_entidad_idx").on(t.entidad, t.entidadId, t.creadoEn)],
);

// ---------------------------------------------------------------------------
// Stock — el núcleo
// ---------------------------------------------------------------------------

/**
 * "El stock de NEXA será independiente del de CPS, pero podrán compartir
 * materiales si la urgencia lo requiriere, a modo de transferencias" (§3.4).
 *
 * En R1 sólo NEXA está activo, pero la columna existe en todo movimiento desde
 * la primera migración: agregarla después obliga a reescribir el histórico.
 */
export const deposito = pgTable("deposito", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(), // "NEXA", "CPS"
  activo: boolean("activo").notNull().default(true),
});

/**
 * La tabla más importante del sistema: una fila por hecho físico.
 *
 * `contrapartidaId` es lo que hace que sobrantes y moliendas (§3.5) sean
 * TRANSFORMACIONES y no ajustes sueltos: la salida de 10 kg de Copolímero 2240P
 * y la entrada de 10 kg de "402-sobrante" quedan unidas, y se puede responder de
 * dónde salió cada kilo. Si se modelaran como ajustes, el inventario cerraría
 * pero se perdería la trazabilidad.
 */
export const movimiento = pgTable(
  "movimiento",
  {
    id: serial("id").primaryKey(),
    tipo: tipoMovimientoEnum("tipo").notNull(),
    depositoId: integer("deposito_id")
      .notNull()
      .references(() => deposito.id),

    // Exactamente uno de los dos. Lo garantiza un CHECK agregado en la migración.
    productoId: integer("producto_id").references(() => producto.id),
    materiaPrimaId: integer("materia_prima_id").references(() => materiaPrima.id),

    // Trazabilidad: el lote o la partida concreta que se movió (§3.3).
    // Nullable en R1, se llenan desde R3/R4.
    loteMpId: integer("lote_mp_id"),
    partidaId: integer("partida_id"),
    cajaId: integer("caja_id"),

    /** Siempre en unidad canónica: baldosa/pieza para producto, kg para MP. */
    cantidad: numeric("cantidad", { precision: 14, scale: 3 }).notNull(),

    origen: origenMovimientoEnum("origen").notNull(),
    origenId: integer("origen_id"), // id del ciclo, pedido, inventario, etc.
    /** Une las dos patas de una transformación o transferencia. */
    contrapartidaId: integer("contrapartida_id"),

    motivo: text("motivo"),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),

    // Auditoría — sin excepción (regla 2 del núcleo).
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuario.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("movimiento_producto_idx").on(t.depositoId, t.productoId, t.fecha),
    index("movimiento_mp_idx").on(t.depositoId, t.materiaPrimaId, t.fecha),
    index("movimiento_origen_idx").on(t.origen, t.origenId),
    index("movimiento_lote_idx").on(t.loteMpId),
    index("movimiento_partida_idx").on(t.partidaId),
  ],
);

/**
 * Caché del ledger. Derivable por completo de `movimiento`; existe sólo por
 * performance. src/lib/data/stock.ts tiene la reconciliación que lo compara
 * contra la suma del ledger.
 */
export const saldo = pgTable(
  "saldo",
  {
    id: serial("id").primaryKey(),
    depositoId: integer("deposito_id")
      .notNull()
      .references(() => deposito.id),
    productoId: integer("producto_id").references(() => producto.id),
    materiaPrimaId: integer("materia_prima_id").references(() => materiaPrima.id),
    cantidad: numeric("cantidad", { precision: 14, scale: 3 }).notNull().default("0"),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saldo_producto_uq").on(t.depositoId, t.productoId),
    uniqueIndex("saldo_mp_uq").on(t.depositoId, t.materiaPrimaId),
  ],
);

/**
 * Lo que arregla el bug que detectó el propio cliente: hoy dos pedidos del mismo
 * producto dicen ambos "OK para armar" habiendo stock para uno solo.
 *
 *     disponible = saldo − reservas ABIERTAS
 *
 * Se consume al armar (pasa a salida real) o se libera al cancelar el pedido.
 */
export const reserva = pgTable(
  "reserva",
  {
    id: serial("id").primaryKey(),
    depositoId: integer("deposito_id")
      .notNull()
      .references(() => deposito.id),
    productoId: integer("producto_id")
      .notNull()
      .references(() => producto.id),
    pedidoLineaId: integer("pedido_linea_id").notNull(),
    cantidad: numeric("cantidad", { precision: 14, scale: 3 }).notNull(),
    estado: estadoReservaEnum("estado").notNull().default("ABIERTA"),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    cerradoEn: timestamp("cerrado_en", { withTimezone: true }),
  },
  (t) => [
    index("reserva_disponible_idx").on(t.depositoId, t.productoId, t.estado),
    index("reserva_linea_idx").on(t.pedidoLineaId),
  ],
);

/**
 * El recuento físico de los viernes (§3.6). No es "corrección manual de stock":
 * es un evento recurrente con responsable, diferencias y motivo, que gerencia mira.
 * Al cerrarse genera los movimientos de AJUSTE, cada uno apuntando acá.
 */
export const inventarioFisico = pgTable("inventario_fisico", {
  id: serial("id").primaryKey(),
  depositoId: integer("deposito_id")
    .notNull()
    .references(() => deposito.id),
  fecha: date("fecha").notNull(),
  estado: estadoInventarioEnum("estado").notNull().default("ABIERTO"),
  responsableId: integer("responsable_id")
    .notNull()
    .references(() => usuario.id),
  observaciones: text("observaciones"),
  cerradoEn: timestamp("cerrado_en", { withTimezone: true }),
});

export const inventarioLinea = pgTable(
  "inventario_linea",
  {
    id: serial("id").primaryKey(),
    inventarioId: integer("inventario_id")
      .notNull()
      .references(() => inventarioFisico.id, { onDelete: "cascade" }),
    productoId: integer("producto_id").references(() => producto.id),
    materiaPrimaId: integer("materia_prima_id").references(() => materiaPrima.id),
    cantidadSistema: numeric("cantidad_sistema", { precision: 14, scale: 3 }).notNull(),
    cantidadContada: numeric("cantidad_contada", { precision: 14, scale: 3 }).notNull(),
    motivo: text("motivo"),
  },
  (t) => [index("inventario_linea_idx").on(t.inventarioId)],
);

// ---------------------------------------------------------------------------
// Materia prima y trazabilidad (R4)
// ---------------------------------------------------------------------------

/**
 * La raíz de la cadena de trazabilidad (§3.3). El procedimiento obliga a pedirlo
 * al proveedor y a numerarlo "correlativamente según orden de llegada (este
 * número servirá para el rastreo inequívoco del certificado)".
 *
 * El PDF escaneado vive en Vercel Blob — de ahí sale la necesidad de Blob en R4.
 */
export const certificadoCalidad = pgTable("certificado_calidad", {
  id: serial("id").primaryKey(),
  numeroCorrelativo: integer("numero_correlativo").notNull().unique(),
  proveedor: text("proveedor").notNull(),
  materiaPrimaId: integer("materia_prima_id")
    .notNull()
    .references(() => materiaPrima.id),
  fechaRecepcion: date("fecha_recepcion").notNull(),
  archivoUrl: text("archivo_url"), // Vercel Blob
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  usuarioId: integer("usuario_id")
    .notNull()
    .references(() => usuario.id),
});

/**
 * El lote del proveedor. ES LO QUE SE ETIQUETA Y SE PIQUEA, no la materia prima
 * genérica — esa es la diferencia con el mockup, donde el lote era un string.
 *
 * `codigoBarra` se valida contra los largos fijos del procedimiento (§3.2):
 * 3 (producto) + 4 (MP) + 8 (proveedor + certificado) + 12 (lote). Los que no
 * cumplen se rechazan con el motivo, en vez de guardarse mal.
 */
export const loteMp = pgTable(
  "lote_mp",
  {
    id: serial("id").primaryKey(),
    materiaPrimaId: integer("materia_prima_id")
      .notNull()
      .references(() => materiaPrima.id),
    certificadoId: integer("certificado_id").references(() => certificadoCalidad.id),
    numeroLote: text("numero_lote").notNull(), // los 12 dígitos del bloque 4
    codigoBarra: text("codigo_barra").notNull().unique(),
    fechaIngreso: date("fecha_ingreso").notNull(),
    cantidadIngresada: numeric("cantidad_ingresada", { precision: 14, scale: 3 }).notNull(),
    ubicacion: text("ubicacion"),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lote_mp_material_idx").on(t.materiaPrimaId, t.fechaIngreso)],
);

/**
 * El retiro diario a tolva (formulario FN°10/2 del procedimiento).
 *
 * El procedimiento fija "un solo retiro diario, siendo responsabilidad del sector
 * de inyectado la correcta planificación del mismo para abastecer la jornada
 * completa" (§3.12): la pantalla de R4 consolida el material del día en un pedido.
 *
 * Es el eslabón que vincula el lote con el ciclo de producción.
 */
export const retiroMp = pgTable("retiro_mp", {
  id: serial("id").primaryKey(),
  fecha: date("fecha").notNull(),
  materiaPrimaId: integer("materia_prima_id")
    .notNull()
    .references(() => materiaPrima.id),
  /** Null = stock de materia prima anterior al registro por lotes (importado del Excel). */
  loteMpId: integer("lote_mp_id").references(() => loteMp.id),
  /** El ciclo de inyección que alimenta: es el eslabón lote → partida. */
  cicloId: integer("ciclo_id").references(() => cicloProduccion.id),
  cantidad: numeric("cantidad", { precision: 14, scale: 3 }).notNull(),
  inyectora: text("inyectora"),
  /** Quien retira (Dylan o su reemplazo) y quien entrega (la encargada de MP). */
  retiraId: integer("retira_id")
    .notNull()
    .references(() => usuario.id),
  entregaId: integer("entrega_id").references(() => usuario.id),
  observaciones: text("observaciones"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  /** Cabecera del retiro a pie de máquina. Null = registro anterior al circuito
   *  de pie de máquina (se consumió directo). */
  retiroMaquinaId: integer("retiro_maquina_id").references(() => retiroMaquina.id),
  /** Código de barras leído al retirar (27 dígitos), validado contra el lote. */
  codigoLeido: text("codigo_leido"),
  /** Anulación auditada (corrección de Supervisión): el stock se revierte con
   *  un movimiento propio; la fila no se borra. */
  anulado: boolean("anulado").notNull().default(false),
  anuladoPorId: integer("anulado_por_id").references(() => usuario.id),
  anuladoEn: timestamp("anulado_en", { withTimezone: true }),
  anuladoMotivo: text("anulado_motivo"),
});

// ---------------------------------------------------------------------------
// Producción (R3)
// ---------------------------------------------------------------------------

/**
 * El N° de partida NEXA. GENERADO POR EL SISTEMA, no tipeado (pregunta 3):
 * "si fuera automático, que cada vez que yo cambio de..." (Eduardo, 16/09).
 *
 * Agrupa todo lo inyectado con la misma combinación de material y color.
 */
export const partida = pgTable("partida", {
  id: serial("id").primaryKey(),
  numero: integer("numero").notNull().unique(), // correlativo generado
  productoId: integer("producto_id").references(() => producto.id),
  descripcionProducto: text("descripcion_producto"), // para el histórico importado
  fechaApertura: date("fecha_apertura").notNull(),
  fechaCierre: date("fecha_cierre"),
  observaciones: text("observaciones"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Inicio y fin separados — pedido explícito de Ignacio en la reunión: "yo esto
 * lo quiero separar en que cargues el inicio, lo guardes, y después cargues el
 * fin y lo guardes, y ahí se calcula todo".
 *
 * Los campos de inicio que el sistema PRECARGA desde el producto (piezas por
 * golpe, ciclo, modo, receta) no se le piden al operario: regla 1 del release.
 */
export const cicloProduccion = pgTable(
  "ciclo_produccion",
  {
    id: serial("id").primaryKey(),
    partidaId: integer("partida_id").references(() => partida.id),
    productoId: integer("producto_id").references(() => producto.id),
    inyectora: text("inyectora").notNull(),

    // Inicio
    fechaInicio: timestamp("fecha_inicio", { withTimezone: true }).notNull(),
    golpesInicio: integer("golpes_inicio"),
    piezasPorGolpe: integer("piezas_por_golpe"),
    cicloSegundos: numeric("ciclo_segundos", { precision: 8, scale: 2 }),
    modo: text("modo"),
    operarioId: integer("operario_id").references(() => usuario.id),

    // Fin
    fechaFin: timestamp("fecha_fin", { withTimezone: true }),
    golpesFin: integer("golpes_fin"),
    /** (golpesFin − golpesInicio) × piezasPorGolpe, editable si no cierra. */
    piezasProducidas: integer("piezas_producidas"),
    piezasDescartadas: integer("piezas_descartadas"),
    /** Lo que efectivamente entra a stock — genera el movimiento de ENTRADA. */
    piezasEntregadas: integer("piezas_entregadas"),
    coladaKg: numeric("colada_kg", { precision: 10, scale: 3 }),
    rebarbaKg: numeric("rebarba_kg", { precision: 10, scale: 3 }),
    scrapKg: numeric("scrap_kg", { precision: 10, scale: 3 }),
    cambioCicloCausa: text("cambio_ciclo_causa"),
    observaciones: text("observaciones"),
    /** Cantidad que el Encargado decide inyectar (planificación); puede ser
     *  distinta de la necesidad calculada. */
    cantidadDeseada: integer("cantidad_deseada"),
    /** Tanda de la planificación que ejecuta esta producción. */
    tandaId: integer("tanda_id"),
    /** Descarte pesado en kilos (suma de los turnos). */
    descarteKg: numeric("descarte_kg", { precision: 10, scale: 3 }),
    /** Pausa (con motivo en evento_produccion): no se carga ni se produce. */
    pausada: boolean("pausada").notNull().default(false),
    /** Cancelada antes de producir: se cerró sin piezas y la tanda volvió a planificar. */
    cancelada: boolean("cancelada").notNull().default(false),

    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    usuarioId: integer("usuario_id").references(() => usuario.id),
  },
  (t) => [
    index("ciclo_partida_idx").on(t.partidaId),
    index("ciclo_fecha_idx").on(t.fechaInicio),
  ],
);

/**
 * Qué pedidos cubre un ciclo — N:M, no un solo FK. Pedido explícito del
 * cliente (docs/06-comentarios-produccion.md §3.1): "en pedido asociado
 * debería poder asociarse varios de ellos, seleccionando prioridades de
 * inyección", y "desplegar la lista de todos los pedidos a inyectar que
 * contengan ese producto para generar la suma total a inyectar". Reemplaza
 * el primer diseño (un `pedidoId` simple en `cicloProduccion`), que no
 * llegó a usarse — sin datos que migrar.
 */
export const cicloPedido = pgTable(
  "ciclo_pedido",
  {
    id: serial("id").primaryKey(),
    cicloId: integer("ciclo_id")
      .notNull()
      .references(() => cicloProduccion.id, { onDelete: "cascade" }),
    pedidoId: integer("pedido_id")
      .notNull()
      .references(() => pedido.id),
    /** Cuánto de este ciclo se destina a este pedido — orientativo para
     *  planificar, no mueve stock (eso sigue pasando al entregar el pedido). */
    cantidadAsignada: integer("cantidad_asignada").notNull(),
  },
  (t) => [index("ciclo_pedido_ciclo_idx").on(t.cicloId), index("ciclo_pedido_pedido_idx").on(t.pedidoId)],
);

/**
 * Qué lotes CONCRETOS se consumieron en el ciclo. Es el eslabón lote ↔ partida.
 *
 * Permite responder las dos preguntas de Eduardo: dado un N° de partida, qué
 * lotes se usaron (y con ellos el certificado de calidad); y dado un lote
 * fallado, qué partidas y qué cajas salieron de él (§3.11).
 *
 * Varias filas por ciclo: "a veces empiezan con polipropileno y después arrancan
 * con polipropileno de segunda" / los pisos ciegos llevan dos materias primas.
 */
export const cicloMateriaPrima = pgTable(
  "ciclo_materia_prima",
  {
    id: serial("id").primaryKey(),
    cicloId: integer("ciclo_id")
      .notNull()
      .references(() => cicloProduccion.id, { onDelete: "cascade" }),
    loteMpId: integer("lote_mp_id").references(() => loteMp.id),
    materiaPrimaId: integer("materia_prima_id")
      .notNull()
      .references(() => materiaPrima.id),
    cantidadKg: numeric("cantidad_kg", { precision: 12, scale: 3 }).notNull(),
    esMaster: boolean("es_master").notNull().default(false),
    /** La carga en tolva que generó este consumo (circuito de pie de máquina). */
    movimientoMaquinaId: integer("movimiento_maquina_id"),
  },
  (t) => [index("ciclo_mp_idx").on(t.cicloId)],
);

/**
 * Retiro de materia prima del depósito a pie de máquina: registro único que
 * agrupa los materiales (virgen y master) llevados a una inyectora. Sus líneas
 * son filas de `retiro_mp`. Puede quedar abierto entre turnos.
 */
export const retiroMaquina = pgTable(
  "retiro_maquina",
  {
    id: serial("id").primaryKey(),
    inyectora: text("inyectora").notNull(),
    cicloId: integer("ciclo_id").references(() => cicloProduccion.id),
    fechaHora: timestamp("fecha_hora", { withTimezone: true }).notNull().defaultNow(),
    /** Operario responsable del material en la máquina. */
    operarioId: integer("operario_id").references(() => usuario.id),
    /** Quien entrega en el depósito. */
    entregaId: integer("entrega_id").references(() => usuario.id),
    productoPrevistoId: integer("producto_previsto_id").references(() => producto.id),
    piezasPrevistas: integer("piezas_previstas"),
    observaciones: text("observaciones"),
    estado: estadoRetiroEnum("estado").notNull().default("ABIERTO"),
    cerradoPorId: integer("cerrado_por_id").references(() => usuario.id),
    cerradoEn: timestamp("cerrado_en", { withTimezone: true }),
    /** Clave de la operación: un doble envío del mismo formulario no duplica. */
    token: text("token").unique(),
    creadoPorId: integer("creado_por_id")
      .notNull()
      .references(() => usuario.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("retiro_maquina_estado_idx").on(t.estado, t.inyectora)],
);

/** Carga en tolva, devolución, sobrante o diferencia justificada de un retiro. */
export const movimientoMaquina = pgTable(
  "movimiento_maquina",
  {
    id: serial("id").primaryKey(),
    retiroMaquinaId: integer("retiro_maquina_id")
      .notNull()
      .references(() => retiroMaquina.id),
    /** Línea de origen (material concreto). Null sólo en SOBRANTE: el sobrante
     *  es mezcla de las líneas cargadas. */
    retiroMpId: integer("retiro_mp_id").references(() => retiroMp.id),
    tipo: tipoMovimientoMaquinaEnum("tipo").notNull(),
    cantidad: numeric("cantidad", { precision: 14, scale: 3 }).notNull(),
    cicloId: integer("ciclo_id").references(() => cicloProduccion.id),
    /** SOBRANTE: el código de sobrante/molienda con el que entra al depósito. */
    materiaPrimaDestinoId: integer("materia_prima_destino_id").references(() => materiaPrima.id),
    /** Movimiento de stock que generó (devolución o sobrante). */
    movimientoId: integer("movimiento_id").references(() => movimiento.id),
    observaciones: text("observaciones"),
    /** Turno en el que se registró (pantalla del operario). */
    turnoId: integer("turno_id"),
    /** Carga distinta de la receta: lo planificado y el motivo de la diferencia. */
    planificadoKg: numeric("planificado_kg", { precision: 14, scale: 3 }),
    motivoExcepcion: text("motivo_excepcion"),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuario.id),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
    token: text("token").unique(),
    anulado: boolean("anulado").notNull().default(false),
    anuladoPorId: integer("anulado_por_id").references(() => usuario.id),
    anuladoEn: timestamp("anulado_en", { withTimezone: true }),
    anuladoMotivo: text("anulado_motivo"),
  },
  (t) => [index("mov_maquina_retiro_idx").on(t.retiroMaquinaId), index("mov_maquina_ciclo_idx").on(t.cicloId)],
);

/**
 * La caja física etiquetada. NO EXISTÍA EN EL MOCKUP, y sin ella no se puede
 * contestar "esta caja, ¿de qué partida salió?" ni sacar de circulación las
 * partidas de un lote fallado.
 *
 * Resuelve además el bug de stock del mockup: la cantidad la trae la caja, no un
 * default de 25 (la caja de rejilla es de 8).
 */
export const caja = pgTable(
  "caja",
  {
    id: serial("id").primaryKey(),
    partidaId: integer("partida_id")
      .notNull()
      .references(() => partida.id),
    productoId: integer("producto_id")
      .notNull()
      .references(() => producto.id),
    cicloId: integer("ciclo_id").references(() => cicloProduccion.id),
    numeroCaja: integer("numero_caja").notNull(),
    cantidad: integer("cantidad").notNull(),
    codigoBarra: text("codigo_barra").notNull().unique(),
    estado: estadoCajaEnum("estado").notNull().default("EN_STOCK"),
    fecha: date("fecha").notNull(),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("caja_partida_idx").on(t.partidaId),
    index("caja_estado_idx").on(t.productoId, t.estado),
  ],
);

// ---------------------------------------------------------------------------
// Ventas y despacho
// ---------------------------------------------------------------------------

export const cliente = pgTable(
  "cliente",
  {
    id: serial("id").primaryKey(),
    nombre: text("nombre").notNull(),
    cuit: text("cuit"),
    condicionIva: condicionIvaEnum("condicion_iva"),
    email: text("email"),
    telefono: text("telefono"),
    domicilio: text("domicilio"),
    localidad: text("localidad"),
    observaciones: text("observaciones"),
    activo: boolean("activo").notNull().default(true),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cliente_nombre_uq").on(t.nombre),
    // "Juan Pérez" y "JUAN PÉREZ " son el mismo cliente: no se duplica.
    uniqueIndex("cliente_nombre_normalizado_uq").on(sql`lower(btrim(${t.nombre}))`),
    index("cliente_cuit_idx").on(t.cuit),
  ],
);

/**
 * El pedido de venta recorre todo el circuito (venta → armado → entrega): no hay
 * una "orden de venta" separada que genere un pedido de despacho.
 *
 * `estado` acompaña al avance real de las líneas, no lo reemplaza: un pedido
 * PARCIALMENTE_DESPACHADO sigue abierto con lo que falta.
 */
export const pedido = pgTable(
  "pedido",
  {
    id: serial("id").primaryKey(),
    numeroOrden: text("numero_orden").unique(),
    clienteId: integer("cliente_id")
      .notNull()
      .references(() => cliente.id),
    fechaPedido: date("fecha_pedido").notNull(),
    fechaEntregaPactada: date("fecha_entrega_pactada"),
    estado: estadoPedidoEnum("estado").notNull().default("PEDIDO"),
    /** Orden manual dentro de los pedidos abiertos; menor = más urgente. */
    prioridad: integer("prioridad").notNull().default(0),

    // Contacto y entrega
    contacto: text("contacto"),
    domicilioEntrega: text("domicilio_entrega"),
    modoEntrega: text("modo_entrega"), // "Flete" | "Retiro en fábrica"
    transporte: text("transporte"),
    requiereColocacion: boolean("requiere_colocacion").notNull().default(false),

    // Comercial — sólo visible de supervisor para arriba (src/lib/auth/permisos.ts)
    metodoPago: text("metodo_pago"),
    total: numeric("total", { precision: 14, scale: 2 }),
    senia: numeric("senia", { precision: 14, scale: 2 }),
    numeroComprobante: text("numero_comprobante"),

    observaciones: text("observaciones"),
    /** Archivado reversible (datos de prueba o históricos que ensucian las
     *  vistas operativas). No borra nada: se puede desarchivar. */
    archivado: boolean("archivado").notNull().default(false),
    /** Clave del formulario de alta: un doble envío no crea dos pedidos. */
    token: text("token").unique(),
    archivadoMotivo: text("archivado_motivo"),
    archivadoEn: timestamp("archivado_en", { withTimezone: true }),
    archivadoPorId: integer("archivado_por_id"),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    usuarioId: integer("usuario_id").references(() => usuario.id),
  },
  (t) => [
    index("pedido_estado_idx").on(t.estado, t.prioridad),
    index("pedido_cliente_idx").on(t.clienteId),
  ],
);

/**
 * La línea es la unidad de avance: pedida → reservada → armada → despachada.
 * Por eso el despacho parcial se resuelve acá y no en el estado del pedido.
 *
 * `productoId` es nullable por el histórico del Excel, donde el color viene como
 * texto libre y a veces multicolor ("Gris oscuro y amarillo"). Esas líneas se
 * importan SIN SKU y se marcan para asignar a mano — no se inventa un producto
 * (pregunta 5 del cliente).
 */
export const pedidoLinea = pgTable(
  "pedido_linea",
  {
    id: serial("id").primaryKey(),
    pedidoId: integer("pedido_id")
      .notNull()
      .references(() => pedido.id, { onDelete: "cascade" }),
    productoId: integer("producto_id").references(() => producto.id),
    /** Texto del Excel cuando no hay SKU resuelto. */
    descripcion: text("descripcion"),
    colorTexto: text("color_texto"),

    /** Siempre en unidad canónica: baldosas o unidades de accesorio. */
    unidadesPedidas: integer("unidades_pedidas").notNull(),
    unidadesArmadas: integer("unidades_armadas").notNull().default(0),
    unidadesDespachadas: integer("unidades_despachadas").notNull().default(0),

    precioUnitario: numeric("precio_unitario", { precision: 14, scale: 2 }),
    observaciones: text("observaciones"),
  },
  (t) => [index("pedido_linea_pedido_idx").on(t.pedidoId)],
);

/**
 * UN PEDIDO PUEDE TENER N DESPACHOS. Es lo que habilita el despacho parcial que
 * pidió el cliente: "un comprador retira del pedido solo los pisos y queda para
 * retirar las rampas a inyectar que estarán listas la semana próxima".
 *
 * Cada despacho tiene su remito, que se imprime sobre los formularios
 * preimpresos de CPS (planilla F.N°12P del procedimiento).
 */
export const remitoInternoSeq = pgSequence("remito_interno_seq", { startWith: 1 });

/** N° de orden de pedido, correlativo y seguro ante altas simultáneas. */
export const pedidoNumeroSeq = pgSequence("pedido_numero_seq", { startWith: 1 });

export const despacho = pgTable(
  "despacho",
  {
    id: serial("id").primaryKey(),
    pedidoId: integer("pedido_id")
      .notNull()
      .references(() => pedido.id, { onDelete: "cascade" }),
    estado: estadoDespachoEnum("estado").notNull().default("ENTREGADO"),
    /** Remito del sistema: correlativo, se asigna al entregar (así un despacho
     *  anulado no deja huecos en la numeración). */
    numeroInterno: integer("numero_interno").unique(),
    /** N° del remito legal preimpreso, si administración imprime ése. */
    numeroRemito: text("numero_remito"),
    fecha: date("fecha").notNull(),
    modoEntrega: text("modo_entrega"),
    transporte: text("transporte"),
    /** Firma de conformidad del fletero — escaneada a Vercel Blob (R5). */
    remitoFirmadoUrl: text("remito_firmado_url"),
    creadoPorId: integer("creado_por_id").references(() => usuario.id),
    /** Primer control (piqueo de armado), al pasar de armado a despacho. */
    control1PorId: integer("control1_por_id").references(() => usuario.id),
    control1En: timestamp("control1_en", { withTimezone: true }),
    control1Resultado: text("control1_resultado"),
    /** Control final, antes de entregar. */
    controladoPorId: integer("controlado_por_id").references(() => usuario.id),
    controlFinalEn: timestamp("control_final_en", { withTimezone: true }),
    controlFinalResultado: text("control_final_resultado"),
    entregadoEn: timestamp("entregado_en", { withTimezone: true }),
    remitoLegalPorId: integer("remito_legal_por_id").references(() => usuario.id),
    remitoLegalEn: timestamp("remito_legal_en", { withTimezone: true }),
    observaciones: text("observaciones"),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("despacho_pedido_idx").on(t.pedidoId)],
);

export const despachoLinea = pgTable(
  "despacho_linea",
  {
    id: serial("id").primaryKey(),
    despachoId: integer("despacho_id")
      .notNull()
      .references(() => despacho.id, { onDelete: "cascade" }),
    pedidoLineaId: integer("pedido_linea_id")
      .notNull()
      .references(() => pedidoLinea.id),
    unidades: integer("unidades").notNull(),
  },
  (t) => [index("despacho_linea_idx").on(t.despachoId)],
);

/**
 * Cada lectura del lector de código de barras queda registrada.
 *
 * El cliente pidió DOS piqueos — uno al pasar de armado a despacho (garantizar
 * que el pedido está completo y bien armado) y otro en el control final
 * (garantizar que se entrega el total de la mercadería) — "y que dichos piqueos
 * queden registrados para garantizar los movimientos".
 *
 * Por eso es tabla y no un contador en la línea: importa quién, cuándo y en cuál
 * de los dos controles.
 */
export const piqueo = pgTable(
  "piqueo",
  {
    id: serial("id").primaryKey(),
    tipo: tipoPiqueoEnum("tipo").notNull(),
    pedidoId: integer("pedido_id")
      .notNull()
      .references(() => pedido.id, { onDelete: "cascade" }),
    pedidoLineaId: integer("pedido_linea_id").references(() => pedidoLinea.id),
    cajaId: integer("caja_id").references(() => caja.id),
    despachoId: integer("despacho_id").references(() => despacho.id),
    codigoLeido: text("codigo_leido").notNull(),
    cantidad: integer("cantidad").notNull(),
    /** Lectura que no correspondía al pedido: el cliente pidió que avise
     *  ("piqué un borde rojo rejilla y me tiene que dar una alerta de que está mal"). */
    conAlerta: boolean("con_alerta").notNull().default(false),
    motivoAlerta: text("motivo_alerta"),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuario.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("piqueo_pedido_idx").on(t.pedidoId, t.tipo)],
);


// ---------------------------------------------------------------------------
// Reclamos y avisos
// ---------------------------------------------------------------------------

/**
 * Reclamo de un cliente (Definiciones pendientes: "las vendedoras tienen que
 * buscar el pedido y detallar qué pasó; el reclamo pasa sí o sí por el
 * supervisor, que detalla la causa y la solución, con opción de enviar el
 * informe a gerencia"). Reemplaza a la tabla `devolucion` (nunca usada): una
 * devolución es un reclamo con `motivoDevolucion`.
 */
export const reclamo = pgTable(
  "reclamo",
  {
    id: serial("id").primaryKey(),
    pedidoId: integer("pedido_id")
      .notNull()
      .references(() => pedido.id),
    despachoId: integer("despacho_id").references(() => despacho.id),
    cajaId: integer("caja_id").references(() => caja.id),
    partidaId: integer("partida_id").references(() => partida.id),
    estado: estadoReclamoEnum("estado").notNull().default("ABIERTO"),
    descripcion: text("descripcion").notNull(),
    motivoDevolucion: motivoDevolucionEnum("motivo_devolucion"),
    causa: text("causa"),
    solucion: text("solucion"),
    observaciones: text("observaciones"),
    supervisorId: integer("supervisor_id").references(() => usuario.id),
    creadoPorId: integer("creado_por_id")
      .notNull()
      .references(() => usuario.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    cerradoPorId: integer("cerrado_por_id").references(() => usuario.id),
    cerradoEn: timestamp("cerrado_en", { withTimezone: true }),
    informeEnviadoPorId: integer("informe_enviado_por_id").references(() => usuario.id),
    informeEnviadoEn: timestamp("informe_enviado_en", { withTimezone: true }),
  },
  (t) => [index("reclamo_pedido_idx").on(t.pedidoId), index("reclamo_estado_idx").on(t.estado)],
);

/** Historial del reclamo: cada paso queda, nunca se edita. */
export const reclamoEvento = pgTable(
  "reclamo_evento",
  {
    id: serial("id").primaryKey(),
    reclamoId: integer("reclamo_id")
      .notNull()
      .references(() => reclamo.id),
    tipo: text("tipo").notNull(), // CREADO, ANALISIS, CAUSA, SOLUCION, OBSERVACION, CERRADO, INFORME
    detalle: text("detalle"),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuario.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reclamo_evento_idx").on(t.reclamoId, t.creadoEn)],
);

/**
 * Avisos internos, dirigidos a un rol: el aviso a ventas cuando un pedido
 * queda listo para despachar, el reclamo nuevo al supervisor y el informe del
 * reclamo a gerencia. Quedan registrados con quién los generó, quién los vio
 * y quién los procesó.
 */
export const aviso = pgTable(
  "aviso",
  {
    id: serial("id").primaryKey(),
    tipo: tipoAvisoEnum("tipo").notNull(),
    destinoRol: rolEnum("destino_rol").notNull(),
    mensaje: text("mensaje").notNull(),
    pedidoId: integer("pedido_id").references(() => pedido.id),
    despachoId: integer("despacho_id").references(() => despacho.id),
    reclamoId: integer("reclamo_id").references(() => reclamo.id),
    creadoPorId: integer("creado_por_id")
      .notNull()
      .references(() => usuario.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    vistoPorId: integer("visto_por_id").references(() => usuario.id),
    vistoEn: timestamp("visto_en", { withTimezone: true }),
    procesadoPorId: integer("procesado_por_id").references(() => usuario.id),
    procesadoEn: timestamp("procesado_en", { withTimezone: true }),
  },
  (t) => [index("aviso_destino_idx").on(t.destinoRol, t.procesadoEn)],
);

// ---------------------------------------------------------------------------
// Minuta 15/10/2026 — planificación, recetas de carga, turnos y relevo
// ---------------------------------------------------------------------------

/**
 * Presentación física de un material: "Bolsa 25 kg" de copolímero, "Bolsita
 * 600 g" o "750 g" de master. El operario carga en presentaciones, no en kilos
 * con decimales; el sistema convierte. Vale para un material puntual
 * (`materiaPrimaId`) o para todos los de un tipo (`tipoMp`).
 */
export const presentacionMp = pgTable("presentacion_mp", {
  id: serial("id").primaryKey(),
  materiaPrimaId: integer("materia_prima_id").references(() => materiaPrima.id),
  tipoMp: tipoMpEnum("tipo_mp"),
  nombre: text("nombre").notNull(),
  kg: numeric("kg", { precision: 10, scale: 3 }).notNull(),
  activo: boolean("activo").notNull().default(true),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Receta de carga en tolva de un producto (producto = familia + tipo + color):
 * qué bolsas de cada material se cargan por tanda. La define el Encargado; el
 * operario la ejecuta. Hay una de régimen y, opcionalmente, una de arranque
 * reforzada para el cambio de color.
 */
export const recetaCarga = pgTable(
  "receta_carga",
  {
    id: serial("id").primaryKey(),
    productoId: integer("producto_id")
      .notNull()
      .references(() => producto.id),
    tipo: tipoRecetaEnum("tipo").notNull().default("REGIMEN"),
    observaciones: text("observaciones"),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadoPorId: integer("actualizado_por_id").references(() => usuario.id),
  },
  (t) => [unique("receta_carga_uq").on(t.productoId, t.tipo)],
);

export const recetaCargaItem = pgTable(
  "receta_carga_item",
  {
    id: serial("id").primaryKey(),
    recetaId: integer("receta_id")
      .notNull()
      .references(() => recetaCarga.id, { onDelete: "cascade" }),
    materiaPrimaId: integer("materia_prima_id")
      .notNull()
      .references(() => materiaPrima.id),
    presentacionId: integer("presentacion_id")
      .notNull()
      .references(() => presentacionMp.id),
    /** Cantidad de presentaciones; admite medias (0,5). */
    cantidad: numeric("cantidad", { precision: 8, scale: 2 }).notNull(),
  },
  (t) => [index("receta_item_receta_idx").on(t.recetaId)],
);

/**
 * Tanda planificada: producto + color + cantidad objetivo. Agrupa pedidos sin
 * perder la relación con cada uno (`tanda_pedido`) y admite una cantidad
 * adicional para stock (o ser sólo para stock). El Encargado la ordena, la
 * posterga y la asigna a una inyectora y un turno.
 */
export const tanda = pgTable(
  "tanda",
  {
    id: serial("id").primaryKey(),
    productoId: integer("producto_id")
      .notNull()
      .references(() => producto.id),
    /** Unidades destinadas a pedidos (suma de tanda_pedido). */
    cantidadPedidos: integer("cantidad_pedidos").notNull().default(0),
    /** Unidades adicionales para stock, sin pedido. */
    cantidadStock: integer("cantidad_stock").notNull().default(0),
    /** Orden en la secuencia de producción (menor = antes). */
    orden: integer("orden").notNull(),
    inyectora: text("inyectora"),
    fecha: date("fecha"),
    turno: turnoEnum("turno"),
    estado: estadoTandaEnum("estado").notNull().default("PLANIFICADA"),
    /** Arrancar con la receta reforzada (cambio de color). */
    usarArranque: boolean("usar_arranque").notNull().default(false),
    observaciones: text("observaciones"),
    postergadaMotivo: text("postergada_motivo"),
    cicloId: integer("ciclo_id").references(() => cicloProduccion.id),
    creadoPorId: integer("creado_por_id")
      .notNull()
      .references(() => usuario.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    actualizadoEn: timestamp("actualizado_en", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tanda_estado_idx").on(t.estado, t.orden)],
);

export const tandaPedido = pgTable(
  "tanda_pedido",
  {
    id: serial("id").primaryKey(),
    tandaId: integer("tanda_id")
      .notNull()
      .references(() => tanda.id, { onDelete: "cascade" }),
    pedidoId: integer("pedido_id")
      .notNull()
      .references(() => pedido.id),
    pedidoLineaId: integer("pedido_linea_id")
      .notNull()
      .references(() => pedidoLinea.id),
    cantidad: integer("cantidad").notNull(),
  },
  (t) => [index("tanda_pedido_tanda_idx").on(t.tandaId), index("tanda_pedido_linea_idx").on(t.pedidoLineaId)],
);

/**
 * Turno de trabajo en una producción: corte intermedio (relevo), distinto del
 * cierre definitivo. Registra golpes al inicio y al relevo, piezas del turno,
 * descarte y motivo de interrupciones. El turno entrante verifica el material
 * recibido a pie de máquina y acepta el relevo (o registra la diferencia).
 */
export const turnoProduccion = pgTable(
  "turno_produccion",
  {
    id: serial("id").primaryKey(),
    cicloId: integer("ciclo_id")
      .notNull()
      .references(() => cicloProduccion.id),
    inyectora: text("inyectora").notNull(),
    turno: turnoEnum("turno").notNull(),
    operarioId: integer("operario_id")
      .notNull()
      .references(() => usuario.id),
    /** Nombre de quien trabaja, cuando la cuenta del taller es compartida. */
    operarioNombre: text("operario_nombre"),
    inicio: timestamp("inicio", { withTimezone: true }).notNull().defaultNow(),
    golpesInicio: integer("golpes_inicio"),
    fin: timestamp("fin", { withTimezone: true }),
    golpesFin: integer("golpes_fin"),
    piezas: integer("piezas"),
    descarteKg: numeric("descarte_kg", { precision: 10, scale: 3 }),
    motivoInterrupcion: text("motivo_interrupcion"),
    observaciones: text("observaciones"),
    /** Recepción del relevo: el material a pie de máquina coincidía. */
    /** Material a pie de máquina y en tolva al cerrar el turno (lo que recibe el siguiente). */
    materialAlCierre: text("material_al_cierre"),
    recepcionOk: boolean("recepcion_ok"),
    recepcionMotivo: text("recepcion_motivo"),
    recepcionDetalle: text("recepcion_detalle"),
    estado: estadoTurnoEnum("estado").notNull().default("ABIERTO"),
    token: text("token").unique(),
    cerradoPorId: integer("cerrado_por_id").references(() => usuario.id),
  },
  (t) => [index("turno_ciclo_idx").on(t.cicloId, t.estado), index("turno_inyectora_idx").on(t.inyectora, t.estado)],
);

/** Novedades de máquina sin movimiento de stock: no se pudo cargar, carga
 *  distinta de la receta, diferencia al recibir el relevo, interrupción. */
export const novedadMaquina = pgTable(
  "novedad_maquina",
  {
    id: serial("id").primaryKey(),
    cicloId: integer("ciclo_id").references(() => cicloProduccion.id),
    turnoId: integer("turno_id").references(() => turnoProduccion.id),
    inyectora: text("inyectora").notNull(),
    tipo: tipoNovedadEnum("tipo").notNull(),
    motivo: text("motivo").notNull(),
    detalle: text("detalle"),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuario.id),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("novedad_ciclo_idx").on(t.cicloId)],
);

/**
 * Fraccionamiento de master: de la bolsa grande se arman bolsitas (600 g,
 * 750 g). No cambia los kilos del depósito (es el mismo material, reenvasado);
 * deja registrado de qué envase salieron y cuántas bolsitas hay armadas.
 */
export const fraccionamientoMp = pgTable("fraccionamiento_mp", {
  id: serial("id").primaryKey(),
  materiaPrimaId: integer("materia_prima_id")
    .notNull()
    .references(() => materiaPrima.id),
  loteMpId: integer("lote_mp_id").references(() => loteMp.id),
  presentacionId: integer("presentacion_id")
    .notNull()
    .references(() => presentacionMp.id),
  cantidad: integer("cantidad").notNull(),
  kgTotal: numeric("kg_total", { precision: 12, scale: 3 }).notNull(),
  observaciones: text("observaciones"),
  usuarioId: integer("usuario_id")
    .notNull()
    .references(() => usuario.id),
  fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
});

/** Historial de la producción: inicio, pausas (con motivo), reanudación,
 *  cancelación y finalización, con quién y cuándo. */
export const eventoProduccion = pgTable(
  "evento_produccion",
  {
    id: serial("id").primaryKey(),
    cicloId: integer("ciclo_id")
      .notNull()
      .references(() => cicloProduccion.id),
    tipo: tipoEventoProduccionEnum("tipo").notNull(),
    motivo: text("motivo"),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuario.id),
    fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evento_produccion_ciclo_idx").on(t.cicloId)],
);
