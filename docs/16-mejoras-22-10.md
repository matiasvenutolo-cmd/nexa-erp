# 16 · Mejoras del 22/10/2026 — usuarios, turnos, recetas, lector, compras, matrices y molino

Fuentes: `mejoras nexa.docx`, `Copia de NEXA - Usuarios y perfiles (1).xlsx`,
`stock MP Nexa 20-10-2026.xlsx` y cuatro fotos de accesorios (cliente, 21-22/10).

Migración: `drizzle/0011_mejoras_v3_modulos.sql` — sólo agrega (tipos, tablas,
columnas) y ajusta datos con auditoría. Probada sobre una copia de la base real
(Neon → PGlite) aplicando 0011 encima de los datos reales. **No aplicada en Neon
todavía** (ver §9).

## 1. Usuarios, perfiles y permisos

- Roles nuevos: `COMPRAS` y `GERENCIA_CONSULTA` (ve todo con precios, no escribe).
- `usuario.roles_adicionales`: una persona puede tener varios perfiles y elige con
  cuál trabaja (selector en el menú). El perfil activo viaja en la sesión y se
  **valida en el servidor en cada pedido** (`getUsuarioActual`): si ya no es suyo,
  vuelve al principal. Con PIN sólo puede usar perfiles de planta
  (`ROLES_CON_PIN`: Operario, Retiros de MP, Despacho, Molino, Matrices).
  `rolPrincipal` va aparte del activo (bug encontrado en la prueba: al cambiar de
  perfil se perdía el principal de la lista; corregido y con test).
- Supervisor: administra usuarios (altas, bajas, cambios, credenciales); no otorga
  ni modifica perfiles de Gerencia (sólo Gerencia). **Sin precios**: se retiró la
  «vista completa» de octubre (el Excel lo define sin precios).
- Mínimos y máximos: Encargado, Supervisor y Gerencia.
- Alta sin credencial = «pendiente de activación». No se generan claves: las carga
  Supervisión desde Administración → Usuarios (restablecimiento = misma acción).
- Emails: se validan (sin espacios, con dominio). Contraseña requiere email; PIN
  sólo perfiles de planta.
- Conciliación con el Excel: `scripts/conciliar-usuarios.ts` (simula por defecto,
  `--aplicar` escribe en una transacción con auditoría; idempotente). Plan:
  - altas pendientes: Braian, Catalina (Gerencia), Gabriel (Gerencia consulta),
    Ailen (Administración), Carolina (Compras, sin apellido), Adriana Troncoso
    (Despacho, **sin email**: el del Excel era el de Sabrina), Ariel, Octavio,
    Franco, Nicolas y Facundo (Operario; emails sin espacios).
  - Eduardo → `egonzalez@cpsudamericana.com`, Alejandra →
    `alejandra@cpsudamericana.com` (emails reales del Excel; misma contraseña).
  - Dylan = Dilan: una sola cuenta, Retiros de MP + Operario + Encargado.
  - «Taller» dado de baja (no se borra; su historial queda).

## 2. Turnos

`esquema_turno_dia` (fecha → SIMPLE/DOBLE/TRIPLE) y `asignacion_operario`
(fecha, turno, operario, inyectora opcional). Producción → «Turnos y operarios».
`turnosPosibles()` resuelve la hora: la noche (22–7) pertenece al día que empezó.
Si hay un solo turno activo no se pregunta; con superposición (12–16 doble,
13–16 triple) manda la asignación del operario y, si no tiene, elige entre los
activos. Los parámetros `turno_*_inicio` quedan sin uso y ocultos.

## 3. Recetas y dosificación

- Dosificación corregida por migración (auditada): 0,015/0,012/0,018 «g/kg» eran
  kg/kg → 15 / 12 / 18 g/kg. Ciego pasa a 30 g/kg (15 g cada 0,5 kg de mezcla
  2630PC + Plastomer), con `proporcion_base1` = null (pendiente).
- Se carga como lo dice el cliente: «g de master cada X kg» (`kg_referencia`).
- Configuración → Master y dosificación compara cada receta activa con la regla
  (no modifica recetas). Hoy: rejilla negro coincide (excepción 12 g/kg); ciego
  trama negro tendría +1,8 kg de master. Las producciones cerradas no cambian.
- El editor de recetas muestra cuánto master corresponde y en qué bolsitas.
- `producto.peso_confirmado` (todo «a confirmar»: el 0,61 kg es general) y
  `producto.acepta_molienda` (aparte del sobrante). Sobrante habilitado en todos
  (migración, auditado). Un sobrante cuyo nombre indica el color de su master no
  se acepta en un producto de otro color.

## 4. Lector de códigos

`src/components/lector-codigo.tsx`: foco fijo (vuelve si queda en la nada, no le
roba foco a otro campo), Enter, antirrebote 1 s, letras/números/guiones, verde/
rojo + sonido. En el retiro a pie de máquina: 27 dígitos = lote; si no, código de
material (acepta el estandarizado: 031 = 31, B24 = 24, B01 = B1); un producto
terminado se rechaza. La carga manual sigue disponible.

## 5. Compras

`compra_mp` + `compra_entrega`. Estados únicos con equivalencias (ver
`EQUIVALENCIAS_ESTADO`). La entrega se registra imputando el **ingreso de
proveedor** a la compra (el stock entra una sola vez, por el ingreso). Necesidad
(`calcularNecesidad`): pedidos (planificados + por planificar) + stock de pisos
bajo el mínimo + mínimo de la MP − disponible = necesidad; − comprado pendiente =
proyectada. Piezas → kg con receta y peso; sin receta/peso, el producto se lista
aparte. Riesgo por compra con demora/faltante (en master sugiere evaluar tono
parecido, no reemplaza).

## 6. Matrices y Molino

- `intervencion_matriz`: cambio de matriz / reparación / service, estado,
  responsable, historial; se ve en el calendario de Producción. No bloquea.
- Molino: `descarte_molino` → `molienda_entrega` (bolsón, kg, código de molienda)
  → Materia Prima confirma (entra como bolsón con código; `bolsonEnTx`) o rechaza.

## 7. Imágenes

Esquineros (volumen = rejilla, chato = ciego) y bordes (tipo «Borde» del
catálogo, hoy sin productos). No se asociaron a «Rampa». El proxy no dejaba pasar
`.jpg` al optimizador de imágenes (devolvía el login): corregido.

## 8. Rendimiento (medido en consultas por pantalla, copia local)

| Pantalla | Antes | Después |
|---|---|---|
| Inicio | 34 | 29 (no recalcula la planificación dos veces) |
| Master y dosificación | 9 + 1 por receta | 10 fijas |
| Compras | 6 + 1 por compra | 7 fijas |

Producción → Compras reutiliza las tandas ya leídas. No se agregaron cachés ni
dependencias. Miniaturas nuevas: 3–9 KB.

## 9. Pasos para producción (requieren autorización)

1. Respaldo y migración 0011 en Neon (unpooled): `npm run db:migrate`.
2. Deploy del código (push a main).
3. `npx tsx scripts/conciliar-usuarios.ts` (revisar) y `--aplicar`.
4. Supervisión carga PIN/contraseñas. Hasta entonces nadie entra por PIN.

Stock de MP (planilla 20/10): `scripts/conciliar-stock-mp.ts` compara contra el
sistema y genera un conteo para `scripts/puesta-en-marcha.ts --conteo=...`. No se
importa: el «Stock al 20/10» es teórico (sin físico), con 24 diferencias, mín/máx
distintos (B24: 100/200 vs 50/75) y máximos menores que el mínimo (B01, B10).

## 10. Preguntas abiertas (responde: Gerencia CPS / Supervisor)

1. Proporción 2630PC / Plastomer en el piso ciego.
2. «Por cada ½ kg de (3 + 19)»: ¿0,5 kg de mezcla (30 g/kg, lo cargado) o medio
   kilo de cada uno (15 g/kg)?
3. ¿El negro de rejilla sigue con 12 g/kg o pasa a 15 g/kg?
4. Peso por pieza de cada tipo de piso y accesorio.
5. Qué turnos admiten cambios de matriz.
6. ¿«Borde» y «Rampa» son la misma pieza? (las fotos se asociaron a Borde).
7. Formato del remito (sigue pendiente).
8. Email de Adriana y apellido de Carolina.
9. Gabriel: ¿necesita permisos de escritura? (hoy sólo consulta).
10. Stock de MP: fecha de corte y conteo físico para la puesta en marcha; corregir
    mín/máx de B01 y B10 en la planilla; materiales A10, A17, 161 y 110 no existen
    en el sistema (alta = cambio estructural).
11. ¿Se mantiene la cuenta genérica «Gerencia» una vez activadas las personales?
