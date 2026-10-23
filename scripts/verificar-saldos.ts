/**
 * Verificación de consistencia del stock (SÓLO LEE): para cada ubicación y
 * material/producto, el saldo guardado tiene que ser igual a la suma de sus
 * movimientos (el ledger es la fuente de verdad). También controla que ningún
 * saldo sea negativo y que cada traslado tenga sus dos patas que se anulan.
 *
 * Signos: ENTRADA suma, SALIDA resta; AJUSTE, TRANSFORMACION y TRANSFERENCIA se
 * guardan con signo.
 *
 * Uso: npx tsx scripts/verificar-saldos.ts
 */
if (!process.env.DATABASE_URL_UNPOOLED) {
  process.loadEnvFile(".env.local");
}

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL_UNPOOLED!, { max: 1 });
  const desajustes = await sql`
    with mov as (
      select deposito_id, producto_id, materia_prima_id,
             sum(case tipo when 'ENTRADA' then abs(cantidad) when 'SALIDA' then -abs(cantidad) else cantidad end) as suma
      from movimiento group by 1, 2, 3
    )
    select d.nombre as ubicacion, coalesce(p.codigo, mp.nombre) as item,
           coalesce(s.cantidad, 0) as saldo, coalesce(m.suma, 0) as ledger
    from mov m
    full join saldo s on s.deposito_id = m.deposito_id
      and s.producto_id is not distinct from m.producto_id
      and s.materia_prima_id is not distinct from m.materia_prima_id
    join deposito d on d.id = coalesce(s.deposito_id, m.deposito_id)
    left join producto p on p.id = coalesce(s.producto_id, m.producto_id)
    left join materia_prima mp on mp.id = coalesce(s.materia_prima_id, m.materia_prima_id)
    where abs(coalesce(s.cantidad, 0) - coalesce(m.suma, 0)) > 0.0005
    order by 1, 2`;
  const negativos = await sql`
    select d.nombre as ubicacion, coalesce(p.codigo, mp.nombre) as item, s.cantidad
    from saldo s join deposito d on d.id = s.deposito_id
    left join producto p on p.id = s.producto_id left join materia_prima mp on mp.id = s.materia_prima_id
    where s.cantidad < -0.0005`;
  const traslados = await sql`
    select a.id, a.cantidad as salida, b.cantidad as entrada
    from movimiento a join movimiento b on b.id = a.contrapartida_id
    where a.tipo = 'TRANSFERENCIA' and abs(a.cantidad + b.cantidad) > 0.0005`;
  const totales = await sql`select count(*)::int as movimientos from movimiento`;
  console.log(`Movimientos revisados: ${totales[0].movimientos}`);
  console.log(`Saldos distintos del ledger: ${desajustes.length}`);
  for (const r of desajustes.slice(0, 40)) console.log(`  ${r.ubicacion} · ${r.item}: saldo ${r.saldo} vs ledger ${r.ledger}`);
  console.log(`Saldos negativos: ${negativos.length}`);
  for (const r of negativos) console.log(`  ${r.ubicacion} · ${r.item}: ${r.cantidad}`);
  console.log(`Traslados cuyas dos patas no se anulan: ${traslados.length}`);
  await sql.end();
  if (desajustes.length || negativos.length || traslados.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
