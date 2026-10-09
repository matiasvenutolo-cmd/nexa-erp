/**
 * Reglas de permisos por rol — traducidas literalmente de la reunión del
 * 16/09/2026 (docs/01-analisis.md §3.10), no inventadas:
 *
 *   "el encargado de pisos tiene que ver todo menos precios... supervisor
 *   soy yo, también, todo menos precios... y de supervisor para arriba,
 *   ventas y gerencia, ellos pueden ver todo."
 *
 * Es decir: sólo GERENCIA y ADMINISTRACION (ventas — Alejandra) ven precios.
 * Todos los demás roles, de supervisor para abajo, no — salvo la vista
 * completa que se habilitó al Supervisor (ver puedeVerPrecios). Vive en una función,
 * no en una columna del usuario (`schema.ts` lo aclara en el comentario de
 * `usuario`), para que la regla no pueda quedar desincronizada fila por fila.
 */
import type { usuario } from "@/lib/db/schema";

type Rol = (typeof usuario.$inferSelect)["rol"];

const ROLES_CON_PRECIOS: readonly Rol[] = ["GERENCIA", "ADMINISTRACION"];

/**
 * CAMBIO DE REGLA (requerimiento de octubre 2026): el Supervisor tiene acceso
 * a las dos vistas — sin precios (por defecto) y completa (con precios) — y
 * elige cuál usar. Sólo el Supervisor; el resto de los roles no cambia.
 */
export function puedeVerPrecios(rol: Rol, vistaCompleta = false): boolean {
  return ROLES_CON_PRECIOS.includes(rol) || (rol === "SUPERVISOR" && vistaCompleta);
}

export function puedeElegirVistaPrecios(rol: Rol): boolean {
  return rol === "SUPERVISOR";
}

/**
 * Corrección de datos de inyección y materia prima por errores de carga
 * (anular retiros o movimientos de máquina, corregir el cierre de un ciclo o
 * la cantidad ingresada de un lote). Mismo requerimiento: sólo Supervisor.
 * Toda corrección queda auditada y, si tocó stock, se regulariza con un
 * movimiento propio (no se borra historial).
 */
export function puedeCorregirProduccionMp(rol: Rol): boolean {
  return rol === "SUPERVISOR";
}

/**
 * Quién puede armar/coordinar pedidos — no sólo verlos. Es la misma lista
 * que gobierna el menú de Catálogo y Clientes en src/lib/nav.ts (single
 * source of truth: `rol.ts` compone su navegación a partir de esto).
 *
 * Ver "Pedidos" es de todos los roles (así lo decidió el propio cliente en
 * el mockup); CREAR uno es una tarea de venta/coordinación. Sin esta
 * distinción, /pedidos/nuevo quedaba alcanzable por URL directa para
 * cualquier rol, sólo por ser una subruta de "/pedidos" — el mismo tipo de
 * hueco de acceso que REINER documentó y cerró (docs/01-analisis.md
 * hallazgo 1: ninguna URL debe quedar sin protección real).
 */
export const ROLES_GESTION: readonly Rol[] = ["GERENCIA", "SUPERVISOR", "ADMINISTRACION", "ENCARGADO"];

export function puedeCrearPedido(rol: Rol): boolean {
  return ROLES_GESTION.includes(rol);
}

/**
 * Dar de alta un producto/color nuevo desde la carga de un pedido (docs/06-
 * comentarios-produccion.md §5 — "colores a medida"). El procedimiento
 * firmado dice que la codificación de productos nuevos se hace "bajo la
 * autorización del supervisor" — mismo criterio que quién gestiona pedidos.
 */
export function puedeCrearProducto(rol: Rol): boolean {
  return ROLES_GESTION.includes(rol);
}

/**
 * Cargar/cerrar ciclos de producción — tarea de piso (Encargado) y de
 * supervisión, no de ventas. Administración queda en ROLES_GESTION por
 * Catálogo/Clientes (apoyo para armar pedidos) pero no tiene motivo para
 * entrar a Producción — regla 7, no agregar secciones que su tarea no usa.
 */
const ROLES_PRODUCCION: readonly Rol[] = ["GERENCIA", "SUPERVISOR", "ENCARGADO"];

export function puedeCargarProduccion(rol: Rol): boolean {
  return ROLES_PRODUCCION.includes(rol);
}

// ---------------------------------------------------------------------------
// Panel Admin — docs/08-configuracion-y-panel-admin.md §permisos
// ---------------------------------------------------------------------------

/**
 * Mínimos y máximos de stock. Definiciones pendientes, respuesta 3: "tendríamos
 * que tener la opción (solo para Encargado) de poder cambiarlos"; la tabla de
 * asunciones del mismo documento agrega "a consideración de gerencia". Se
 * habilita a los dos — contradicción anotada como pregunta abierta.
 */
const ROLES_MIN_MAX: readonly Rol[] = ["ENCARGADO", "GERENCIA"];

export function puedeEditarMinMax(rol: Rol): boolean {
  return ROLES_MIN_MAX.includes(rol);
}

/** Dosificación de master y parámetros de producción (cajas, margen del
 *  semáforo): quien carga producción. Sin definición explícita del cliente. */
export function puedeEditarParametrosProduccion(rol: Rol): boolean {
  return ROLES_PRODUCCION.includes(rol);
}

/** Colores (incluye registrar un color especial): mismo criterio que dar de
 *  alta un producto desde la carga del pedido. */
export function puedeGestionarColores(rol: Rol): boolean {
  return puedeCrearProducto(rol);
}

/** Alta, rol y baja de usuarios: sólo gerencia. */
export function puedeAdministrarUsuarios(rol: Rol): boolean {
  return rol === "GERENCIA";
}

/**
 * Cambiar la prioridad de inyección de un pedido. Definiciones pendientes:
 * "con opción a ser cambiada por el encargado o supervisor en base a
 * planificación".
 */
const ROLES_PRIORIDAD: readonly Rol[] = ["ENCARGADO", "SUPERVISOR"];

export function puedeCambiarPrioridad(rol: Rol): boolean {
  return ROLES_PRIORIDAD.includes(rol);
}

export function puedeVerPanelAdmin(rol: Rol): boolean {
  return (
    puedeEditarMinMax(rol) ||
    puedeEditarParametrosProduccion(rol) ||
    puedeGestionarColores(rol) ||
    puedeAdministrarUsuarios(rol)
  );
}

// ---------------------------------------------------------------------------
// Despacho, materia prima, reclamos (R4/R5)
// ---------------------------------------------------------------------------

/**
 * Armar un despacho, hacer el primer control (piqueo de armado) y el control
 * final: el sector despacho (Sabrina Orellano, procedimiento firmado) y quienes
 * coordinan la planta. El procedimiento no exige que los dos controles los haga
 * una persona distinta, así que no se bloquea: se registra y se muestra.
 */
const ROLES_DESPACHO: readonly Rol[] = ["DESPACHO", "ENCARGADO", "SUPERVISOR", "GERENCIA"];

export function puedeOperarDespacho(rol: Rol): boolean {
  return ROLES_DESPACHO.includes(rol);
}

/** El remito legal lo emite administración ("la orden de despacho es manejada
 *  por administración"). */
export function puedeRegistrarRemitoLegal(rol: Rol): boolean {
  return rol === "ADMINISTRACION" || rol === "GERENCIA";
}

/** Ingreso de materia prima con su certificado y lote (Daniela Tenorio). */
const ROLES_INGRESO_MP: readonly Rol[] = ["MATERIA_PRIMA", "SUPERVISOR", "GERENCIA"];

export function puedeIngresarMateriaPrima(rol: Rol): boolean {
  return ROLES_INGRESO_MP.includes(rol);
}

/** Retiro de materia prima a máquina (Dylan Romero) y quien la entrega. */
const ROLES_RETIRO_MP: readonly Rol[] = ["RETIROS_MP", "MATERIA_PRIMA", "ENCARGADO", "SUPERVISOR", "GERENCIA"];

export function puedeRetirarMateriaPrima(rol: Rol): boolean {
  return ROLES_RETIRO_MP.includes(rol);
}

export function puedeVerMateriaPrima(rol: Rol): boolean {
  return puedeIngresarMateriaPrima(rol) || puedeRetirarMateriaPrima(rol);
}

/** "Las vendedoras tienen que buscar el pedido y detallar qué pasó". */
const ROLES_CARGAN_RECLAMO: readonly Rol[] = ["ADMINISTRACION", "SUPERVISOR", "GERENCIA"];

export function puedeCrearReclamo(rol: Rol): boolean {
  return ROLES_CARGAN_RECLAMO.includes(rol);
}

/** "Este reclamo pasa sí o sí por el supervisor". */
export function puedeResolverReclamo(rol: Rol): boolean {
  return rol === "SUPERVISOR";
}

const ROLES_VEN_RECLAMOS: readonly Rol[] = ["ADMINISTRACION", "SUPERVISOR", "GERENCIA", "ENCARGADO"];

export function puedeVerReclamos(rol: Rol): boolean {
  return ROLES_VEN_RECLAMOS.includes(rol);
}

/** Trazabilidad: quienes investigan reclamos o lotes. */
const ROLES_TRAZABILIDAD: readonly Rol[] = ["GERENCIA", "SUPERVISOR", "ENCARGADO", "ADMINISTRACION", "MATERIA_PRIMA"];

export function puedeVerTrazabilidad(rol: Rol): boolean {
  return ROLES_TRAZABILIDAD.includes(rol);
}
