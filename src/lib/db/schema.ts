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

import {
  boolean,
  date,
  index,
  integer,
  numeric,
  pgEnum,
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
 * "AZUL OSCURO" de los Excel.
 *
 * PENDIENTE pregunta 1 del cliente: la lista oficial con sus iniciales.
 */
export const color = pgTable("color", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
  iniciales: text("iniciales").notNull().unique(), // NE, AO, AC, GO, GC...
  oficial: boolean("oficial").notNull().default(false), // false = deducido del Excel, a confirmar
});

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
    unidadesPorCaja: integer("unidades_por_caja"), // Rejilla 8 · Ciego 25 — pregunta 9
    pesoCajaKg: numeric("peso_caja_kg", { precision: 8, scale: 3 }),

    // Nullable hasta la pregunta 8: hoy 70 de 94 productos quedarían en rojo.
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
 * Master por kg de materia prima, por color.
 *
 * ⚠️ CONTRADICCIÓN ABIERTA (pregunta 2): el Excel dice 0,015 kg/kg (150 g cada
 * 10 kg) y en la reunión se dijo "150 g cada 25 kg" (0,006). Son 2,5× distintos.
 * Se carga el valor del Excel marcado como provisorio hasta que confirmen.
 */
export const ratioMaster = pgTable(
  "ratio_master",
  {
    id: serial("id").primaryKey(),
    colorId: integer("color_id")
      .notNull()
      .references(() => color.id),
    proveedorMasterId: integer("proveedor_master_id").references(() => proveedorMaster.id),
    materiaPrimaId: integer("materia_prima_id")
      .notNull()
      .references(() => materiaPrima.id), // el master concreto
    kgPorKgMp: numeric("kg_por_kg_mp", { precision: 8, scale: 5 }).notNull(),
    provisorio: boolean("provisorio").notNull().default(true),
  },
  (t) => [unique("ratio_master_uq").on(t.colorId, t.proveedorMasterId)],
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
  loteMpId: integer("lote_mp_id")
    .notNull()
    .references(() => loteMp.id),
  cantidad: numeric("cantidad", { precision: 14, scale: 3 }).notNull(),
  inyectora: text("inyectora"),
  /** Quien retira (Dylan o su reemplazo) y quien entrega (la encargada de MP). */
  retiraId: integer("retira_id")
    .notNull()
    .references(() => usuario.id),
  entregaId: integer("entrega_id").references(() => usuario.id),
  observaciones: text("observaciones"),
  creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
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
    pedidoId: integer("pedido_id"), // producción contra pedido, o para stock
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

    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    usuarioId: integer("usuario_id").references(() => usuario.id),
  },
  (t) => [
    index("ciclo_partida_idx").on(t.partidaId),
    index("ciclo_fecha_idx").on(t.fechaInicio),
  ],
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
  },
  (t) => [index("ciclo_mp_idx").on(t.cicloId)],
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
  (t) => [uniqueIndex("cliente_nombre_uq").on(t.nombre), index("cliente_cuit_idx").on(t.cuit)],
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
export const despacho = pgTable(
  "despacho",
  {
    id: serial("id").primaryKey(),
    pedidoId: integer("pedido_id")
      .notNull()
      .references(() => pedido.id, { onDelete: "cascade" }),
    numeroRemito: text("numero_remito"),
    fecha: date("fecha").notNull(),
    modoEntrega: text("modo_entrega"),
    transporte: text("transporte"),
    /** Firma de conformidad del fletero — escaneada a Vercel Blob (R5). */
    remitoFirmadoUrl: text("remito_firmado_url"),
    controladoPorId: integer("controlado_por_id").references(() => usuario.id),
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

/**
 * El circuito de devoluciones del procedimiento (§3.11). Toda devolución pasa
 * obligatoriamente por el supervisor general.
 *
 * El caso grave es MATERIAL_DEFECTUOSO: obliga a "detectar si existen partidas
 * en Stock para sacarlas de circulación y enviarlas a reciclado", lo que sólo es
 * posible con la cadena de trazabilidad completa.
 */
export const devolucion = pgTable(
  "devolucion",
  {
    id: serial("id").primaryKey(),
    pedidoId: integer("pedido_id")
      .notNull()
      .references(() => pedido.id),
    despachoId: integer("despacho_id").references(() => despacho.id),
    motivo: motivoDevolucionEnum("motivo").notNull(),
    descripcion: text("descripcion").notNull(),
    partidaAfectadaId: integer("partida_afectada_id").references(() => partida.id),
    resolucion: text("resolucion"),
    resueltoEn: timestamp("resuelto_en", { withTimezone: true }),
    /** Derivación obligatoria al supervisor general. */
    supervisorId: integer("supervisor_id").references(() => usuario.id),
    creadoEn: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
    usuarioId: integer("usuario_id")
      .notNull()
      .references(() => usuario.id),
  },
  (t) => [index("devolucion_pedido_idx").on(t.pedidoId)],
);
