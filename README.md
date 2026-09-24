# NEXA · Sistema de producción y stock

Sistema a medida para la línea de pisos plásticos **NEXA**, unidad de negocio de
Conexiones Plásticas Sudamericana SRL (CPS).

No es un prototipo descartable: es la aplicación real (Next.js + TypeScript,
Postgres en Neon vía Drizzle), corriendo en la cuenta de Pinaro sobre tiers
gratuitos. Antes de la puesta en marcha en planta se traspasa a la cuenta de
CPS — ver [docs/04-runbook-traspaso.md](docs/04-runbook-traspaso.md).

Deploy: **https://nexa-erp-two.vercel.app** — URL autogenerada de Vercel por
ahora, el dominio propio se define antes de la puesta en marcha en planta.

Reemplaza a un encadenamiento de Excel + Google Forms. El análisis completo del
negocio y de por qué se refundó el mockup previo está en
[docs/01-analisis.md](docs/01-analisis.md).

## Empezar

```bash
npm install
npx vercel link
npx vercel env pull .env.local --environment=preview
npm run db:migrate
npm run db:import-excel
npm run dev
```

## Roadmap — evolutivo de 6 meses, un release por mes

| Release | Entrega | Estado |
|---|---|---|
| **R1** | Núcleo (auth, migraciones, ledger de stock, reservas, auditoría) + **Pedidos** | En curso |
| **R2** | **Stock**: movimientos, disponible/comprometido/a producir, inventario físico semanal | — |
| **R3** | **Producción**: cola priorizada, ciclo inicio/fin, partidas generadas, cajas | — |
| **R4** | **Materia prima y trazabilidad**: recetas, lotes, certificados, consumo real | — |
| **R5** | **Etiquetas y despacho**: despacho parcial, doble piqueo, remitos, devoluciones | — |
| **R6** | **Planificación**: necesidad semanal de compra de MP, compras en proceso, tablero | — |

El orden sigue el que definió el propio cliente en la minuta
(Pedidos → Stock → Producción → Partidas → Etiquetas → Despacho), más la capa
de planificación al final.

## Base de datos

Postgres (Neon), conectado por la integración de Storage de Vercel. El schema
vive en [`src/lib/db/schema.ts`](src/lib/db/schema.ts) y es la fuente de verdad
del modelo ([docs/02-modelo-datos.md](docs/02-modelo-datos.md)).

**Migraciones versionadas desde el primer commit** (`db:generate` + `db:migrate`),
no `db:push`. El mockup previo usaba un seed que borraba y recargaba la base
entera: con datos reales cargados eso es pérdida total.

```bash
npm run db:generate      # genera la migración a partir del schema
npm run db:migrate       # la aplica
npm run db:import-excel  # importa los .xlsx de /data — idempotente, nunca borra
```

## Documentación

- [docs/01-analisis.md](docs/01-analisis.md) — negocio, hallazgos, arquitectura, **preguntas abiertas**
- [docs/02-modelo-datos.md](docs/02-modelo-datos.md) — esquema y por qué de cada decisión
- [docs/03-plan-release-1.md](docs/03-plan-release-1.md) — plan de construcción de R1
- `docs/04-runbook-traspaso.md` — checklist de traspaso a la cuenta de CPS (se escribe antes de R5)
- `docs/migracion-datos.md` — reporte de la importación (auto-generado)
- `docs/entregables/` — informes que recibe el cliente

## Fuentes del cliente

`/data` tiene los archivos originales de CPS. Los dos que gobiernan el modelo:

- **`Procedimientos Nexa.docx`** — el procedimiento operativo firmado por todo el personal. Es el
  documento más importante del proyecto: define roles, la regla de codificación de productos, el
  formato del código de barras de materia prima y los circuitos de molienda, sobrantes,
  inventario físico y devoluciones.
- **`Calculo por metro.nexaxlsx.xlsx`** — las recetas de material, pesos y equivalencias.
