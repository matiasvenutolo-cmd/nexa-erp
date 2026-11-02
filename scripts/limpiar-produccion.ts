/**
 * Limpieza de producción pedida por el cliente (02/11/2026): borrar las
 * órdenes de producción (tandas), las producciones (ciclos) y sus partidas,
 * cargadas como ejemplo durante la capacitación.
 *
 * SEGURO POR DISEÑO (igual que scripts/poner-en-cero.ts):
 *  1. Respaldo completo en respaldos/<fecha>/*.json.
 *  2. Simulación por defecto: cuenta lo que se borraría.
 *  3. Ejecución sólo con --ejecutar --confirmar=PRODUCCION-<AAAA-MM-DD de hoy>,
 *     en una sola transacción.
 *
 * El stock no cambia (decisión del cliente): los movimientos del ledger se
 * conservan, así que la materia prima consumida sigue descontada y los saldos
 * siguen cuadrando. Se conservan también Molino (el descarte queda sin la
 * producción de origen) y Compras. Al no quedar partidas, la próxima del año
 * vuelve a ser la 0001.
 */
if (!process.env.DATABASE_URL_UNPOOLED) {
  process.loadEnvFile(".env.local");
}

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const args = new Set(process.argv.slice(2));
const confirmar = process.argv.find((a) => a.startsWith("--confirmar="))?.split("=")[1];
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const ejecutar = args.has("--ejecutar");
const frase = `PRODUCCION-${hoy}`;
if (ejecutar && confirmar !== frase) {
  console.error(`Para ejecutar hace falta --confirmar=${frase} (confirmación explícita).`);
  process.exit(1);
}
const MOTIVO = `Limpieza de producción pedida por el cliente (${hoy})`;
const sql = postgres(process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!, { max: 1 });

/** De las hojas a la raíz: las claves foráneas no borran en cascada. */
const PASOS: { tabla: string; sentencia: string; detalle: string }[] = [
  { tabla: "intervencion_matriz", sentencia: "delete from intervencion_matriz", detalle: "intervenciones de matrices" },
  { tabla: "descarte_molino", sentencia: "update descarte_molino set ciclo_id = null where ciclo_id is not null", detalle: "descartes de molino desvinculados de la producción (se conservan)" },
  { tabla: "movimiento_maquina", sentencia: "delete from movimiento_maquina", detalle: "movimientos a pie de máquina" },
  { tabla: "retiro_mp", sentencia: "delete from retiro_mp", detalle: "renglones de retiro de MP" },
  { tabla: "retiro_maquina", sentencia: "delete from retiro_maquina", detalle: "retiros a pie de máquina" },
  { tabla: "novedad_maquina", sentencia: "delete from novedad_maquina", detalle: "novedades de máquina" },
  { tabla: "turno_produccion", sentencia: "delete from turno_produccion", detalle: "turnos / relevos" },
  { tabla: "evento_produccion", sentencia: "delete from evento_produccion", detalle: "eventos (pausas)" },
  { tabla: "ciclo_materia_prima", sentencia: "delete from ciclo_materia_prima", detalle: "material usado por producción" },
  { tabla: "ciclo_pedido", sentencia: "delete from ciclo_pedido", detalle: "vínculos producción ↔ pedido" },
  { tabla: "tanda_pedido", sentencia: "delete from tanda_pedido", detalle: "vínculos tanda ↔ pedido" },
  { tabla: "tanda", sentencia: "delete from tanda", detalle: "órdenes de producción (tandas)" },
  { tabla: "caja", sentencia: "delete from caja", detalle: "cajas (ya dadas de baja)" },
  { tabla: "ciclo_produccion", sentencia: "delete from ciclo_produccion", detalle: "producciones" },
  { tabla: "partida", sentencia: "delete from partida", detalle: "partidas" },
];

async function main() {
  console.log(`\nLimpieza de producción · ${ejecutar ? "EJECUCIÓN" : "SIMULACIÓN (no se escribe nada)"}\n`);
  const dir = path.join("respaldos", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  for (const { table_name } of await sql<{ table_name: string }[]>`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`) {
    writeFileSync(path.join(dir, `${table_name}.json`), JSON.stringify(await sql.unsafe(`select * from "${table_name.replace(/"/g, "")}"`), null, 1));
  }
  console.log(`1) Respaldo completo en ${dir}/\n\n2) Se borraría:`);
  const conteo: Record<string, number> = {};
  for (const p of PASOS) {
    const donde = p.tabla === "descarte_molino" ? " where ciclo_id is not null" : "";
    conteo[p.tabla] = Number((await sql.unsafe(`select count(*)::int n from "${p.tabla}"${donde}`))[0].n);
    console.log(`   · ${p.detalle}: ${conteo[p.tabla]}`);
  }
  const enCircuito = await sql`select count(*)::int n from saldo s join deposito d on d.id = s.deposito_id where d.nombre in ('Pie de máquina', 'Tolva / en proceso') and s.cantidad <> 0`;
  console.log(`\n3) Stock: no cambia. Material en pie de máquina o tolva: ${enCircuito[0].n} (tiene que ser 0).`);
  if (enCircuito[0].n > 0) throw new Error("Hay material a pie de máquina o en tolva: conciliar los retiros antes de limpiar.");

  if (!ejecutar) {
    console.log(`\nSimulación terminada. Para aplicar: --ejecutar --confirmar=${frase}\n`);
    return;
  }
  await sql.begin(async (tx) => {
    for (const p of PASOS) await tx.unsafe(p.sentencia);
    const [sistema] = await tx`select id from usuario where nombre = 'Importación (sistema)' order by id limit 1`;
    for (const [entidad, n] of Object.entries(conteo)) {
      if (n === 0) continue;
      await tx`insert into auditoria_config (entidad, entidad_id, campo, valor_anterior, valor_nuevo, motivo, usuario_id) values (${entidad}, 'todos', 'limpieza', ${String(n)}, '0', ${MOTIVO}, ${sistema.id})`;
    }
  });
  console.log(`\nListo. Respaldo en ${dir}/. Verificar con: npx tsx scripts/verificar-saldos.ts\n`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
