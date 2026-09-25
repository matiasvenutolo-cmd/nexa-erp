# Reporte de importación

> Auto-generado por `scripts/import-excel.ts` el 2026-09-25. No editar a
> mano — se sobreescribe en cada corrida. Las asunciones de fondo están
> justificadas en `docs/01-analisis.md`.

## Catálogo de productos

95 de 108 filas con NUMERO se importaron como producto.

**Descartadas (13):**

- 067-g · "067 Grampa de union"
- 100-R · "100-RCAJAS CHICAS"
- Rejil · ""
- Rejil · ""
- Rejil · ""
- Rejil · ""
- Rejil · ""
- Ciego · ""
- Ciego · ""
- Ciego · ""
- Ciego · ""
- Ciego · ""
- Ciego · ""


**Sin proveedor de master identificado (2)** — quedan con `proveedorMasterId` null:

- 016-- · letra ""
- 026-- · letra ""

## Materia prima

50 de 50 filas importadas.

## Clientes

50 clientes nuevos (docs/01-analisis.md §6 pregunta 10 — falta la base real de ~360).

## Pedidos

- 0 pedidos importados de 69 filas (el resto ya existía de una corrida anterior).
- 0 líneas de pedido generadas, **0 sin SKU resuelto** (color multicolor o no reconocido — quedan para asignación manual, docs/01-analisis.md §6 pregunta 5).
- 0 filas con accesorio (borde/esquinero) donde la familia se asumió por default (REJILLA) al haber más de una familia de piso en la misma fila, o ninguna — docs/01-analisis.md §6 pregunta 8.
- 0 filas con "Si" en la columna de bordes (cantidad sin especificar) — se cargaron con cantidad 1 para revisar.

**Filas sin fecha, no importadas** (4) — en la planilla real son los totales al pie ("UNIDADES TOTALES", "Metros totales") o pedidos con la fecha ilegible en origen; ninguna se guardó con una fecha inventada:
- EDUARDO RICA
- ROBERTO JORGE FUENTE
- UNIDADES TOTALES
- Metros totales

**Estados no reconocidos** (se importaron como ENTREGADO):
Ninguno.

**Variantes de método de pago originales** (se guardan tal cual, sin normalizar todavía):


## Qué no se importa en esta etapa

Partidas, ciclos de producción, lotes de materia prima y certificados de
calidad son R3/R4 (docs/02-modelo-datos.md §7) — no se leen todavía, aunque
estén en `/data` (`CARGA INYECTORAS...`, `N° DE PARTIDA`).
