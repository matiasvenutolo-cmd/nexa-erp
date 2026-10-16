# Puesta en marcha — arranque limpio

Acordado en la minuta del 15/10/2026: aprobar el sistema, seguir en paralelo
con el Excel y arrancar limpio un lunes con stock de materia prima, stock de
producto y pedidos vigentes, sin históricos en las vistas operativas.

**Nada se borra.** Los históricos se archivan (reversible) para conservar la
trazabilidad; los saldos se ajustan con movimientos de inventario auditados.

## Antes del corte (viernes)

1. Cerrar todas las producciones en curso y conciliar los retiros (pie de
   máquina y tolva en cero). El script lo controla.
2. Ventas confirma qué pedidos siguen vigentes; Supervisión archiva a mano los
   que no (Pedido → "Archivar pedido") o deja que lo haga el script.
3. Materia prima y Despacho hacen el conteo físico y lo pasan a un CSV:

   ```
   tipo;codigo;cantidad
   mp;31;2.800,95
   mp;24;87,255
   producto;001B-PR-NE;1250
   ```

   Cantidades con la convención argentina (punto de miles, coma decimal).

## Simulación (no escribe nada)

```bash
npx tsx scripts/puesta-en-marcha.ts --corte=2026-11-02 --conteo=conteo.csv
```

Hace un respaldo completo (`respaldos/<fecha>/`, una planilla JSON por tabla,
fuera del control de versiones) y muestra:

- pedidos a archivar: cerrados anteriores al corte y sin producto asignado
  (avisa los que están abiertos);
- diferencias del conteo contra el sistema, una por una;
- producciones abiertas y material en pie de máquina o tolva.

Simulación del 16/10/2026 sobre la base actual: 64 pedidos a archivar (53
entregados, 11 abiertos sin producto: #47, #50, #51, #52, #56, #57, #58, #60,
#61, #62, #65), sin producciones abiertas ni material en circuito.

## Ejecución (requiere confirmación explícita)

```bash
npx tsx scripts/puesta-en-marcha.ts --corte=2026-11-02 --conteo=conteo.csv --ejecutar --confirmar=ARRANQUE-2026-11-02
```

En una sola transacción: archiva los pedidos listados y registra un ajuste de
INVENTARIO por cada diferencia (motivo "Conteo físico del arranque"). Vuelve a
hacer el respaldo antes de escribir.

## Después

- Verificar en Materia prima → Stock y Stock de productos que los saldos
  coinciden con el conteo.
- Definir las recetas de carga de los colores que se van a producir esa
  semana (Configuración → Recetas de carga).
- Seguir en paralelo con el Excel hasta validar; cada error se informa con
  "Informar un error" y lo corrige Supervisión.
- Para deshacer un archivado: Pedidos → Archivados → Desarchivar.
