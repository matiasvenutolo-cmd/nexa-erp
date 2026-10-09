# 12 — Circuito de materia prima con pie de máquina y análisis del Excel de stock de MP (09/10/2026)

Requerimiento: operación con turnos rotativos de 24 h; distinguir el material
retirado del depósito, el que espera a pie de máquina, el cargado en tolva, lo
producido y lo devuelto. Fuente: `stock materia prima 01-10-2026nexa 31-10-2026.xlsx`.

## 1. Análisis del Excel (9 hojas)

| Hoja | Qué contiene | Uso en el sistema |
|---|---|---|
| STOCK | Por material: stock 30/09, ingresos y egresos de octubre (fórmulas desde INGRESO/EGRESO), stock 06/10, columna "físico 09/10" **vacía**, mínimo, máximo; secciones virgen, masters, "muestra o alternativos" y "sobrantes y moliendas". | Fuente de comparación. **No se importó**: el físico no está relevado y el saldo es teórico (ver §2). |
| INGRESO / EGRESO | Movimientos diarios de octubre por material (sólo días 1, 2, 5 y 6 cargados). Las transferencias CP↔NEXA se marcan con color de celda (no queda en los valores). | Equivalen a ingresos y retiros del sistema; no se reimportan (duplicarían movimientos). |
| BOLSONES | Canastos y bolsones de moliendas de **CP** (115, 116, 123, 124, 5, 300, 301), junio 2025. | Histórico de otra planta; sin uso. |
| BOLSONES (variante con espacio) | Moliendas NEXA 400, 401, 410 por canasto, may–sep 2026. | Coincide con los códigos 4xx del sistema; base para un futuro control por canasto. |
| MASTER | Por master: bolsas armadas (peso por bolsa, p. ej. 0,75 kg), cantidad entregada por día, "sobrante por diferencia de balanza"; cuadro normalizado color → proveedor → master. | Confirma la nomenclatura de masters. Ver §3 (unidad del master). |
| DATOS DE LA COMPRA | 68 compras may–oct 2026: material, código del proveedor, kg, proveedor, orden de compra, remito, lote, certificado, recibido por. | Mismo dato que el ingreso con certificado; faltan en el sistema OC, remito y código del proveedor. Sin código de barras de 27 dígitos: no se pueden crear lotes sin inventar el código. |
| GRAFICOS | "Stock materia prima octubre **2024**", 83 celdas con error. | Vista auxiliar obsoleta. |
| borrador | Copia de BOLSONES sin fechas. | Auxiliar. |

Nomenclatura: el Excel escribe "B 1", "P 2", "p10"; el sistema "B1", "P2", "P10"
(mismo material). No existen en el sistema: A10 (master gris 3218, 3,98 kg), A17
(master metal plata, 0,4 kg), 161 (sobrante PP 2240P c/master azul) y 110
(sobrante plastomer); no se crearon.

## 2. Conciliación de stock de MP (Excel al 06/10 vs sistema al 09/10, antes de la prueba)

El stock del sistema parte del snapshot del Excel al 11/08 más los movimientos
registrados en el sistema. Las diferencias muestran que el Excel siguió
recibiendo ingresos y egresos que no se cargaron en el sistema. **No se ajustó
ningún saldo**: corresponde un recuento físico y un ajuste de inventario
auditado con fecha de corte, a confirmar por el cliente.

| Código Excel | Material | Excel 06/10 (kg) | Sistema (kg) | Diferencia |
|---|---|---:|---:|---:|
| 3 | 3-Polipropileno COPOLIMERO   COD:2630PC | 6.925 | 3.950 | -2.975 |
| 4 | 04- polipropileno homopolimero | 0 | 0 | 0 |
| 6 | 6-Polietileno COD:8818 MEDIA | 0 | 0 | 0 |
| 19 | 19- PLASTOMER | 1.475 | 374 | -1.101 |
| 31 | 31-COPOLIMERO 2240 P | 3.000 | 2.800 | -200 |
| 38 | 38-compuesto PE AD SN | 0 | 0 | 0 |
| 21 | 21-Master Azul | 51,305 | 22,38 | -28,925 |
| 24 | 24-Master negro 951 | 53,465 | 87,555 | 34,09 |
| B 1 | B1-Master Gris Oscuro 105808 | 20,29 | 33,17 | 12,88 |
| B 3 | B3-Master Blanco | 0 | 0 | 0 |
| B 4 | B4-Master Azul oscuro 100954 | 4,459 | 4,459 | 0 |
| B 5 | B5- Master Amarillo 114247 | 2,025 | 2,7 | 0,675 |
| A5 | A5- Master Amarillo 7228 | 17 | 5 | -12 |
| B 6 | B6- Master Verde 113227 | 11,365 | 2,496 | -8,869 |
| B 7 | B7-Master Rojo 100319 | 19,548 | 6,896 | -12,652 |
| B10 | B10-Master Gris Oscuro nor 108900 (gris claro catalogo) | 48,08 | 8,45 | -39,63 |
| B11 | B11-Master celeste 112228 | 17,107 | 0,06 | -17,047 |
| A9 | A9-Master naranja 7363 | 15,782 | 4,209 | -11,573 |
| A14 | A14- Master Yute 4101 | 18,088 | 5,198 | -12,89 |
| A3 | A3-MASTER BLANCO 7500 | 42,502 | 2,802 | -39,7 |
| P 1 | P1-Master Gris Oscuro 991700 | 1,275 | 1,275 | 0 |
| P 2 | P2 Master Gris Claro 991010 | 0,335 | 0,335 | 0 |
| P 3 | P3-Master Blanco | 0 | 0 | 0 |
| P 4 | P4-Master Azul oscuro 961515 | 1 | 1 | 0 |
| P 5 | P5- Master Amarillo1303342 | 0,75 | 0,75 | 0 |
| P 6 | P6- Master Verde 1704673 | 0,68 | 0,68 | 0 |
| P 7 | P7-Master Rojo1501925 | 1,075 | 1,075 | 0 |
| P 8 | P8-Master Azul claro am 068 | 0,148 | 0,148 | 0 |
| P 9 | P9-Master Naranja 1100406 | 0,62 | 0,62 | 0 |
| p10 | P10-Master negro991333 | 1,635 | 1,635 | 0 |
| p11 | P11-Master celeste  961150 | 0,74 | 0,74 | 0 |
| P15 | P15-master perlado 020 | 0,172 | 0,172 | 0 |
| A4 | A4- Master Azul 3351 | 77,288 | 14,503 | -62,785 |
| A6 | A6-Master Verde 4170 | 20,025 | 3,558 | -16,467 |
| A12 | A12-MASTER VIOLETA 3353 | 0,844 | 0,844 | 0 |
| A13 | A13-MASTER OBISPO 3119 | 1,665 | 1,665 | 0 |
| B16 | B16-fucsia 107410 | 4,1 | 0,3 | -3,8 |
| 40 | 40- Polipropileno copolimero kunlun | 25 | 25 | 0 |
| 41 | 41-polipropileno copolimero  sinopec | 25 | 25 | 0 |
| 400 | 400-molienda mezcla de pisos(prueba) | 270,18 | 270,18 | 0 |
| 401 | 401- molienda p.rejillas (c-31) | 577,2 | 222,6 | -354,6 |
| 402 | 402- sobrante polipropileno Copolimero 2630p | 4,2 | 0 | -4,2 |
| 403 | 403- sobrante polipropileno Copolimero 2240p | 0 | 0 | 0 |
| 404 | 404- sobante plastomer | 0 | 0 | 0 |
| 405 | 405- sobrante  polipropileno homopolimero | 0 | 0 | 0 |
| 406 | 406-Sobante polipropileno homopolimero esencia | 13 | 13 | 0 |
| 407 | 407- sobrante homopolimero esencia c M/ AZUL | 10,6 | 10,6 | 0 |
| 408 | 408-sobrante plastomer y copolimero 2630pc c/ gris oscuro nordico | 0 | 9,5 | 9,5 |
| 409 | 409-sobrante compuesto PE AD SN | 0 | 0 | 0 |
| 410 | 410-Molienda P- ciego c03+c19 | 190,8 | 150,2 | -40,6 |

No existen en el sistema: A10 A10-Master gris 3218 (3.98 kg); A17 A17-Master Metal Plata 3018 (0.4 kg); 161 161-sobrante pp copolimero 2240p c/m azul (0 kg); 110 110-sobrante plastomer (0 kg)

## 3. Unidad del master — contradicción a resolver

El parámetro vigente es **0,015 / 0,012 / 0,018 g de master por kg de MP**
(definición del cliente). La propia documentación del cliente indica otra cosa:

- "Calculo por metro", hoja "master x kg MP": "cada 10 kg = 150 g de master";
  "por bolsa de 25 → 375 g" (= 0,015 **kg** por kg).
- Excel de MP, hoja MASTER: bolsas de master de 0,75 kg; el 05/10 se entregaron
  17 bolsas = 12,75 kg de B1 (también en EGRESO).

Con g/kg, el sistema calcula para 45 piezas (27,5 kg de MP) 0,33 **g** de
master; con la planilla serían ≈ 0,41 **kg**. El valor no se cambió; el cálculo
de master necesario queda supeditado a esta confirmación.

## 4. Implementación

### Modelo (migración `0007_pie_de_maquina`, aditiva)
- `retiro_maquina`: registro único del retiro a pie de máquina (inyectora,
  ciclo, fecha y hora, operario responsable, quien entrega, producto y piezas
  previstas, observaciones, estado ABIERTO/CERRADO, clave anti-repetición).
- `retiro_mp` pasa a ser la línea de material del retiro (+ código leído y
  anulación auditada). Las filas anteriores quedan como "anteriores al circuito".
- `movimiento_maquina`: CARGA_TOLVA, DEVOLUCION, SOBRANTE, DIFERENCIA, con
  usuario, fecha/hora, ciclo, clave anti-repetición y anulación auditada.
- `ciclo_produccion.cantidad_deseada`; `ciclo_materia_prima.movimiento_maquina_id`.

### Reglas (`src/lib/data/maquina.ts`)
- Retiro: descuenta el depósito (ledger) una sola vez; con ciclo, la inyectora es
  la del ciclo; el código leído se valida contra el lote y el producto (3 primeros
  dígitos 000 o el número del producto del ciclo).
- A pie de máquina = retirado − cargado − devuelto − diferencia justificada.
- Carga en tolva: no toca el depósito; sólo en un ciclo en curso de la misma
  inyectora y de la misma partida (entre turnos y jornadas); otra producción
  exige devolver o registrar sobrante. Crea el vínculo lote → ciclo (trazabilidad).
- Devolución sin mezclar: vuelve al depósito (y al disponible del lote).
- Sobrante mezclado: entra al depósito con un código existente SOBRANTE/MOLIENDA,
  con la composición; no supera lo cargado.
- Cierre del retiro: exige 0 a pie de máquina; lo que no cierra se justifica
  (DIFERENCIA) — no se modifican cantidades. Queda abierto entre turnos.
- Concurrencia: bloqueo de la línea/cabecera y del saldo; clave por operación.

### Control por ciclo
Retirado, cargado (virgen y master), devuelto, sobrante, piezas teóricas
((cargado − sobrante) ÷ kg por pieza), buenas, descarte y diferencia
(cargado − sobrante − producidas × peso − colada/rebarba/scrap). Si falta el
peso por pieza se informa.

### Datos técnicos (migración `0008`, auditada)
0,16 m² por baldosa y 0,61 kg (pisos); rampa 0,1175 kg; esquinero 0,02 kg
(planilla "Calculo por metro"; ángulo = esquinero por 4 piezas por golpe). Se
corrigió `m2_por_unidad`, que tenía m² de stock. Configurable en Panel Admin →
Productos.

### Otros puntos del requerimiento
- Cantidad a producir: necesidad de pedidos, reposición hasta el mínimo,
  recomendado y cantidad deseada (persistida); el cierre explica el destino.
- Resumen del pedido: baldosas por producto y color, accesorios por tipo y
  color, total y m² (accesorios no suman; pisos sin dato se informan).
- Remitos: tabla en el pedido con despacho, cantidades entregadas, responsable.
- Supervisor: **cambio de regla de precios** — vista sin precios (por defecto)
  o completa, sólo para Supervisor; correcciones auditadas (anular línea de
  retiro o movimiento de máquina con reversión de stock, corregir cierre de
  ciclo con ajuste y cajas, corregir kg ingresados de un lote).
- Ya implementados en la revisión anterior y verificados: menú por áreas,
  inyectora, flujo de partida, "Listo para despachar", vinculación por color,
  nombres de lote.

## 5. Pruebas
89 tests (17 nuevos en `tests/pie-de-maquina.test.ts`). Prueba en la UI contra
la base real, ver informe de estado.

## 6. Pendientes del cliente
1. Unidad del master (§3).
2. Fecha de corte y recuento físico para conciliar el stock de MP (§2); alta de
   A10, A17, 161 y 110.
3. Códigos de sobrante por color de master (existe "c/ azul" y "c/ gris oscuro
   nórdico"; no hay uno para mezcla con negro u otros colores).
4. Si la carga en tolva la registra el operario (hoy: roles de retiro de MP,
   Encargado, Supervisor, Gerencia).
5. Si corresponde registrar OC, remito y código del proveedor en el ingreso.
6. Confirmar que "ángulo" de la planilla equivale a "esquinero".
