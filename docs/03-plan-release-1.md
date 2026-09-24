# Release 1 — Núcleo + Pedidos

**Objetivo:** que Alejandra cargue los pedidos de venta en el sistema en lugar del Excel, y que al
cargarlos el sistema le diga **al instante** qué hay en stock, qué queda reservado y qué falta
producir — sin que nadie más tenga que re-tipear nada.

Es el MVP que se acordó en la minuta: *"la primera versión debería reemplazar ese circuito
mediante una pantalla/sistema de carga de pedidos"*.

## Por qué R1 incluye stock

Un pedido sin chequeo de stock no reemplaza al Excel: hoy la vendedora igual tiene que
preguntarle a alguien si hay. Por eso R1 lleva el **ledger de stock y las reservas** (no las
pantallas de gestión de stock, que son R2). Es la mitad invisible del release y la que sostiene
todo lo demás.

## Orden de construcción

**0 · Andamiaje**
Next.js 16 + TS + Tailwind v4 + Drizzle. Repo `matiasvenutolo-cmd/nexa-erp`, proyecto de Vercel
propio, Postgres en Neon vía la integración de Storage. Migraciones versionadas
(`db:generate` + `db:migrate`) desde el primer commit — no `db:push`.

**1 · Importador idempotente**
`scripts/import-excel.ts`. Reemplaza al seed destructivo del mockup. Reglas:
- Upsert por **clave natural** (código de producto, código interno de MP, nombre de cliente).
- **Nunca borra.** Correrlo dos veces no duplica ni pisa datos cargados por el cliente.
- Emite `docs/migracion-datos.md` con el reporte de asunciones, igual que en REINER.
- Normaliza colores contra la tabla `color` y **reporta los que no matchean** en vez de inventarlos.

**2 · Auth real**
Sesión firmada con `jose`. Email+contraseña para administración/supervisión/gerencia, PIN para
operarios. Middleware que protege las rutas de verdad — no wayfinding. Los 8 roles de §3.10 del
análisis, con la matriz de permisos que definió el cliente (de supervisor para abajo, nadie ve
precios).

**3 · Catálogo**
Productos con el código derivado de sus componentes (§3.1), colores como tabla, proveedores de
master. Pantalla de consulta + alta de producto nuevo siguiendo la regla de codificación del
procedimiento.

**4 · Ledger de stock + reservas**
`movimiento`, `saldo`, `reserva`, `deposito`. Sin pantalla propia todavía (eso es R2): sólo la
capa de datos, la reconciliación saldo↔ledger, y el cálculo de disponible.

**5 · Clientes**
Alta y búsqueda, con CUIT y condición de IVA. Importación de la base real cuando llegue
(pregunta 10).

**6 · Carga de pedido**
La pantalla central del release. Réplica del Excel de ventas pero con el color elegido de lista
(→ SKU siempre resuelto), resumen en vivo de m² y unidades, y **chequeo de stock con reservas**
línea por línea: disponible / reservado / falta producir.

**7 · Listado y ciclo de vida del pedido**
Filtros por estado, prioridad manual, detalle con las líneas y su avance, edición y anulación
(con liberación de reservas).

## Reglas de diseño no negociables

1. **El dato se carga una vez, donde ocurre el hecho físico.** Ninguna pantalla puede pedir algo
   que el sistema ya sabe. Es la regla que sale del problema raíz (§2 del análisis).
2. **Nada se escribe en stock sin su movimiento**, en la misma transacción, con usuario y fecha.
3. **Unidad canónica siempre.** m², cajas y bolsas se muestran, no se guardan.
4. **Vocabulario del cliente en la UI.** El procedimiento firmado es el glosario.
5. **Toda asunción que se toma para avanzar se escribe como pregunta abierta** en este documento,
   con quién la responde.
6. **Pantallas de planta a prueba de apuro.** Eduardo: *"los chicos realmente no tienen
   conocimiento… que lo pueda agarrar cualquiera de los operarios"*.

## Preguntas que bloquean R1

Son las que no se pueden esquivar con una asunción razonable. Detalle completo en
`01-analisis.md` §6.

| # | Pregunta | Para |
|---|---|---|
| 2 | Lista oficial de colores con nombre exacto y sus dos iniciales | Eduardo |
| 3 | Color multicolor en una celda: ¿varias líneas o producto especial? | Alejandra |
| 5 | ¿Unidades por caja siempre Rejilla 8 / Ciego 25? | David |
| 6 | ¿Carga directa en el sistema o seguimos importando el Excel de ventas? | Alejandra |
| 10 | Base real de clientes (~360): ¿de dónde se exporta? ¿con CUIT? | Alejandra |

**Asunciones tomadas mientras no haya respuesta** (todas reversibles, todas a confirmar):

- Colores: se usa la lista deducida de `Hoja2` del Excel de cálculo (12 colores), normalizada.
- Multicolor: se importa como línea **sin SKU resuelto**, marcada para asignación manual. No se
  inventa un producto.
- Unidades por caja: Rejilla 8 / Ciego 25 según `Calculo por metro.xlsx`. **No se usa 25 como
  default universal** — ese fue el bug del mockup.
- Clientes: se importan los ~60 que aparecen en el Excel de ventas; el resto se da de alta a
  medida que se usan.

**Confirmado el 24/09/2026:** el cliente no cargó ningún dato real en el prototipo, así que la
importación arranca de cero desde `/data` sin nada que rescatar de la base anterior.

## Fuera de alcance de R1

Producción, partidas, etiquetas, despacho, materia prima y planificación. Cada uno tiene su
release. Lo que sí entra desde R1 es su **estructura de datos**, para no migrar después
(`02-modelo-datos.md` §7).

## Definición de terminado

R1 está listo cuando Alejandra puede cargar un pedido real de punta a punta sin abrir el Excel, y
el pedido queda con su stock reservado y su faltante calculado. Se valida con ella en planta, no
por pantalla compartida.
