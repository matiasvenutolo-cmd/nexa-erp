# 21 · Compras ejecuta, Materia prima decide (nov. 2026)

Pedido de NEXA: Compras sólo ejecuta las compras que le envía Materia prima;
Materia prima ve en su tabla de stock qué hay que comprar.

## Qué cambió

**Materia prima → Stock general**

- Columnas: Stock general · Comprometido a producción · Mínimo · Estado.
- Comprometido: lo que todavía necesitan las tandas planificadas y en curso
  (lo que falta producir, con la receta y el peso por pieza). Se cubre primero
  con lo que ya está a pie de máquina.
- Estado: **Compra urgente** si el stock general no alcanza para lo que falta
  llevar a esas tandas; **Compra próximamente** si lo que queda libre no cubre
  los pedidos sin planificar más el margen del material; **OK** el resto.
- Orden: urgente, próximamente, OK (molienda y sobrante al final, no se
  compran). Filtro «Sólo para comprar».
- «Pedir a Compras» trae la cantidad sugerida (para volver a OK, descontando
  lo ya pedido o en compra). La fila muestra lo que está en compra, la fecha
  de llegada y si hay demora o faltante en proveedor.
- Margen de compra por material: Panel admin → Configuración → Mínimos y
  máximos → Materia prima. Vacío = el mínimo.

**Compras**

- Pestañas: Pedidos para comprar · Estado de compras · Proveedores.
- Se quitaron la necesidad de materia prima y el alta de compras sueltas.
- Ejecutar un pedido: proveedor (obligatorio, de la ficha), cantidad, precio
  por kg o total (el otro se calcula), moneda, entrega estimada, N° de OC.
- Estado de compras: una sola lista con filtro En curso / Ejecutadas /
  Canceladas / Todas y por proveedor. Se editan proveedor y montos.
- Proveedores: ficha (CUIT, contacto, teléfono, email, dirección, condición
  de pago), historial de compras y cumplimiento: % de entregas a tiempo
  (última entrega contra la entrega estimada), demora promedio, compras
  vencidas y total comprado por moneda.

**Migración 0016** (no destructiva): tabla `proveedor`; en `compra_mp`
`proveedor_id`, `precio_kg`, `monto_total`, `moneda`; en `materia_prima`
`aviso_compra_kg`. Los proveedores que ya figuraban en compras (Berma, Arcolor,
Cimco) pasan a la ficha y se vinculan. El texto `proveedor` se conserva.

## Preguntas abiertas (responde: Gerencia CPS / Materia prima / Compras)

1. «Compra urgente cuando ya no alcanza para la producción que ya está en
   marcha»: se tomó como tandas planificadas **y** en curso. ¿O sólo las que
   están produciendo?
2. «Compra próximamente»: pedidos sin planificar + margen por material (vacío
   = el mínimo). ¿Cuenta también la reposición del stock mínimo de pisos?
3. Compras ya no puede registrar una compra sin pedido de Materia prima.
   ¿Hace falta para alguna urgencia?
4. Montos: ¿con o sin IVA? ¿Alcanzan pesos y dólares?
5. El cumplimiento se mide contra la entrega estimada vigente: si Compras la
   corrige, se mide contra la nueva. ¿Medir contra la primera fecha que dio el
   proveedor?
6. Un material ya pedido sigue en «Compra próximamente» (con «En compra: X kg»)
   hasta que llega. ¿Prefieren un estado aparte «En compra»?
7. En el ingreso de materia prima el proveedor sigue siendo texto libre.
   ¿Elegirlo de la ficha también ahí?
