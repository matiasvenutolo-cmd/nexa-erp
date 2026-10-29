import sys
from docx import Document
from docx.enum.section import WD_ORIENT  # noqa
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

REPO = "/Users/matiasvenutolo/ClaudeCode/nexa-erp"
AZUL = RGBColor(0x00, 0x20, 0x94)
NARANJA = RGBColor(0xEE, 0x7D, 0x30)
GRIS = RGBColor(0x55, 0x5B, 0x6E)

doc = Document()
for s in doc.sections:
    s.top_margin = s.bottom_margin = Cm(1.8)
    s.left_margin = s.right_margin = Cm(2)
st = doc.styles["Normal"]
st.font.name = "Calibri"
st.font.size = Pt(10.5)
st.paragraph_format.space_after = Pt(3)


def sombrear(celda, color):
    tcPr = celda._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), color)
    tcPr.append(shd)


def titulo(texto, sub=None):
    p = doc.add_paragraph()
    r = p.add_run(texto)
    r.bold = True
    r.font.size = Pt(18)
    r.font.color.rgb = AZUL
    p.paragraph_format.space_after = Pt(2)
    if sub:
        p = doc.add_paragraph()
        r = p.add_run(sub)
        r.font.color.rgb = GRIS
        r.font.size = Pt(10)
    linea = doc.add_paragraph()
    pPr = linea._p.get_or_add_pPr()
    bdr = OxmlElement("w:pBdr")
    b = OxmlElement("w:bottom")
    b.set(qn("w:val"), "single")
    b.set(qn("w:sz"), "12")
    b.set(qn("w:color"), "EE7D30")
    bdr.append(b)
    pPr.append(bdr)


def sub(texto):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(8)
    r = p.add_run(texto)
    r.bold = True
    r.font.size = Pt(12)
    r.font.color.rgb = NARANJA


def parrafo(texto):
    p = doc.add_paragraph()
    partes = texto.split("**")
    for i, t in enumerate(partes):
        r = p.add_run(t)
        r.bold = i % 2 == 1
    return p


def _item(marca, it):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.6)
    p.paragraph_format.first_line_indent = Cm(-0.5)
    r = p.add_run(marca + "\t")
    r.bold = True
    r.font.color.rgb = NARANJA
    p.paragraph_format.tab_stops.add_tab_stop(Cm(0.6))
    partes = it.split("**")
    for i, t in enumerate(partes):
        p.add_run(t).bold = i % 2 == 1


def vinetas(items):
    for it in items:
        _item("•", it)


def pasos(items):
    for n, it in enumerate(items, 1):
        _item(f"{n}.", it)


def recuadro(etiqueta, texto):
    t = doc.add_table(rows=1, cols=1)
    c = t.rows[0].cells[0]
    sombrear(c, "EEF1FB")
    p = c.paragraphs[0]
    r = p.add_run(etiqueta + " ")
    r.bold = True
    r.font.color.rgb = AZUL
    p.add_run(texto)
    doc.add_paragraph()


def salto():
    doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)


def area(nombre, quienes, que, como, ojo):
    titulo(nombre)
    recuadro("Quién lo usa:", quienes)
    sub("Qué se puede hacer")
    vinetas(que)
    for encabezado, lista in como:
        sub(encabezado)
        pasos(lista)
    if ojo:
        sub("Si algo no deja avanzar")
        vinetas(ojo)
    salto()


# ---------------------------------------------------------------- portada
doc.add_picture(f"{REPO}/docs/marca/logo-nexa.png", width=Cm(3.2))
titulo("Manual de uso por área", "Sistema de Producción y Stock NEXA · una hoja por sector · octubre 2026")
parrafo("Cada sector tiene su propia hoja: qué puede hacer, quién tiene acceso y cómo se usa, paso a paso. Se puede imprimir sólo la hoja de cada área.")
sub("Cómo entrar")
vinetas([
    "Abrir **nexa-erp-two.vercel.app** → «Entrar al sistema». Funciona desde cualquier computadora, tablet o celular con internet (no hace falta estar conectado al servidor de la empresa).",
    "**Oficina, Supervisión y Gerencia:** email y contraseña.",
    "**Planta** (operarios, retiros de MP, despacho, molino, matrices): elegir el nombre y escribir el PIN. No hace falta tener una casilla de correo.",
    "Quien tiene más de un perfil (por ejemplo, Retiros de MP y Operario) elige con cuál trabaja desde el menú.",
    "Cada uno ve sólo lo que su tarea necesita. Si un botón no aparece, esa tarea es de otro sector.",
    "Si se cargó algo mal: botón **«Informar un error»** (abajo del menú). Lo corrige Supervisión o Gerencia, con motivo.",
])
sub("Quién entra a cada sección")
filas = [
    ("Sección", "Lo usan", "Sólo consultan"),
    ("Pedidos", "Administración, Encargado, Supervisor, Gerencia", "Despacho, Retiros de MP, Gerencia (consulta)"),
    ("Clientes", "Administración, Encargado, Supervisor, Gerencia", "Gerencia (consulta)"),
    ("Stock de productos", "Encargado, Supervisor, Gerencia (mínimos y máximos)", "Administración, Gerencia (consulta)"),
    ("Reclamos", "Administración (carga), Supervisor y Gerencia (resuelven)", "Encargado, Gerencia (consulta)"),
    ("Despacho (dentro del pedido)", "Despacho, Encargado, Supervisor, Gerencia", "—"),
    ("Remito legal", "Administración, Gerencia", "—"),
    ("Producción", "Encargado, Supervisor, Gerencia", "Gerencia (consulta)"),
    ("Mi turno (celular)", "Operario, Encargado, Supervisor, Gerencia", "—"),
    ("Materia prima", "Materia prima, Retiros de MP, Encargado, Supervisor, Gerencia", "Compras, Gerencia (consulta)"),
    ("Compras", "Compras, Supervisor, Gerencia", "Materia prima, Encargado, Gerencia (consulta)"),
    ("Matrices", "Matrices, Encargado, Supervisor, Gerencia", "Gerencia (consulta)"),
    ("Molino", "Molino, Materia prima (recibe), Supervisor, Gerencia", "Encargado, Gerencia (consulta)"),
    ("Usuarios", "Supervisor, Gerencia (Administración: usuarios de planta)", "—"),
    ("Configuración y parámetros", "Encargado, Supervisor, Gerencia", "—"),
]
t = doc.add_table(rows=len(filas), cols=3)
t.style = "Table Grid"
t.alignment = WD_TABLE_ALIGNMENT.CENTER
for i, f in enumerate(filas):
    for j, v in enumerate(f):
        c = t.rows[i].cells[j]
        c.text = v
        for p in c.paragraphs:
            p.paragraph_format.space_after = Pt(0)
            for r in p.runs:
                r.font.size = Pt(9)
                if i == 0:
                    r.bold = True
                    r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        if i == 0:
            sombrear(c, "002094")
parrafo("Los precios sólo los ven Gerencia, Gerencia (consulta) y Administración.").runs[0].font.size = Pt(9)
salto()

# ---------------------------------------------------------------- áreas
area(
    "Ventas y Administración",
    "Administración. También Encargado, Supervisor y Gerencia. Gerencia (consulta) ve todo pero no modifica.",
    [
        "**Pedidos:** cargar, editar, cambiar la prioridad y seguir en qué estado está cada uno.",
        "**Clientes:** dar de alta y editar los datos (CUIT, domicilio, contacto).",
        "**Stock de productos:** ver qué hay de cada producto y color, y sus movimientos.",
        "**Reclamos:** registrar el reclamo de un cliente y seguir su análisis.",
        "**Remito legal:** registrar el número del remito legal de cada entrega.",
        "**Avisos:** se recibe el aviso cuando un pedido está listo o hay un error informado.",
    ],
    [
        ("Cargar un pedido", [
            "Pedidos → **«+ Nuevo pedido»**.",
            "Elegir el cliente (si no existe, crearlo antes en Clientes → «Nuevo cliente»).",
            "Fecha de entrega pactada y, si tiene, número de orden de compra.",
            "Un renglón por producto + color + cantidad. Guardar.",
            "Si es urgente: dentro del pedido → Prioridad (Urgente / Adelantado / Postergado) y el motivo.",
        ]),
        ("Cerrar la entrega", [
            "Cuando Despacho termina el control final, el pedido muestra la tabla «Remitos».",
            "Imprimir el remito interno y registrar el **número del remito legal**.",
        ]),
        ("Registrar un reclamo", [
            "Reclamos → **«Registrar reclamo»**: cliente, pedido y qué pasó (si se sabe, la caja o partida).",
            "Supervisión lo analiza y lo cierra; el historial queda en el reclamo.",
        ]),
    ],
    [
        "Un pedido ya entregado no se edita: pedir la corrección a Supervisión.",
        "Para buscar un pedido: filtros por cliente, estado y fecha de entrega en la lista.",
    ],
)

area(
    "Despacho",
    "Despacho (entra con PIN). También Encargado, Supervisor y Gerencia.",
    [
        "Ver los pedidos listos para entregar.",
        "Armar el despacho leyendo el código de cada caja.",
        "Hacer el primer control y el control final antes de entregar.",
    ],
    [
        ("Preparar una entrega", [
            "Pedidos → abrir el pedido → **«Preparar despacho»**.",
            "Leer el código de cada caja con el lector (si la caja va completa no hace falta escribir nada; si van baldosas sueltas, escribir la cantidad en baldosas).",
            "Revisar el resumen y **«Confirmar primer control»**.",
            "Antes de cargar: **«Hacer control final»**, volver a leer las cajas y confirmar. Se numera el remito interno.",
        ]),
    ],
    [
        "«El control final no coincide con lo armado»: falta releer alguna caja; la lista de lecturas muestra qué se leyó.",
        "El lector marca en rojo un código que no corresponde al pedido o a ese producto.",
    ],
)

area(
    "Producción (Encargado)",
    "Encargado. También Supervisor y Gerencia. Gerencia (consulta) sólo mira.",
    [
        "**Planificación:** armar las tandas a partir de los pedidos y ordenarlas.",
        "**Turnos y operarios:** definir si el día es de turno simple, doble o triple y qué operario va en cada turno y máquina.",
        "**Calendario por turno, En curso, Relevos y novedades, Historial:** seguir la producción.",
        "**Compras:** ver qué material pide la planificación y cuánto falta.",
        "**Configuración:** recetas de carga, mínimos y máximos de stock, parámetros.",
    ],
    [
        ("Planificar e iniciar una producción", [
            "Producción → **Planificación**. A la derecha, «Por planificar» junta los pedidos de cada producto y color.",
            "**«Planificar tanda»**: destildar lo que queda para después y sumar extra para stock si hace falta.",
            "En la tanda: ordenar con ↑ ↓ y **«Asignar máquina, turno y cantidades»**. Revisar receta y material.",
            "**«Iniciar producción»** con los golpes que marca la máquina.",
        ]),
        ("Cargar los turnos del día", [
            "Producción → **Turnos y operarios**: elegir el día, el esquema (simple, doble o triple) y asignar cada operario.",
        ]),
    ],
    [
        "«Sin receta de carga»: definirla en Configuración → Recetas de carga.",
        "Avisos de la tanda: cambio de matriz o de color, entrega próxima, falta de material.",
    ],
)

area(
    "Operarios — Mi turno",
    "Operarios de planta, con PIN y desde el celular. También Encargado, Supervisor y Gerencia.",
    [
        "Tomar el turno, cargar la tolva según la receta, cerrar el turno y terminar la producción.",
    ],
    [
        ("Durante el turno", [
            "**«Tomar el turno»**: el sistema propone el turno según la hora y la asignación del día. Si hay relevo, confirmar el material que se recibe.",
            "**«Cargué la tanda completa»**: un toque por cada carga de la receta. Si se cargó distinto: «Cargué distinto», + / − y el motivo. Si no se pudo: «No pude cargar».",
            "**«Terminar mi turno»**: golpes que marca la máquina, descarte pesado en kg e interrupciones.",
            "Al terminar la tanda: **«Terminó la producción»**. Lo bueno entra al stock en cajas; si sobró material mezclado, se registra con su código de sobrante.",
        ]),
    ],
    [
        "«Tomá el turno antes de cargar la tolva»: falta el primer paso.",
        "«A pie de máquina hay X kg… la carga pide Y»: falta retirar material (avisar a Retiros de MP) o cargar lo que hay con «Cargué distinto».",
    ],
)

area(
    "Materia prima",
    "Materia prima. Supervisor y Gerencia también. Compras y Gerencia (consulta) sólo miran.",
    [
        "**Stock general** y **stock a pie de máquina** de cada material, ordenado por código (3, 4, 6, 19, 31… A3, B1…).",
        "**Ingreso de proveedor** con lote y certificado.",
        "**Movimientos:** todo lo que entró y salió, día por día, con quién lo hizo.",
        "**Operaciones de stock:** ajuste de balanza, **descarte**, molienda en bolsones y fraccionamiento de master.",
        "Recibir la molienda que entrega el Molino.",
    ],
    [
        ("Ingreso de proveedor", [
            "Materia prima → **«+ Ingreso de proveedor»**.",
            "Material, proveedor, fecha, kg (1.500 se escribe «1.500»), código de barras de la bolsa y certificado si lo trae.",
            "Si la cantidad es rara, el sistema pide confirmarla una vez.",
        ]),
        ("Descarte (material que se pierde)", [
            "Ejemplo: se cayó media bolsa de master. Materia prima → **Operaciones de stock** → «Descarte de material».",
            "Elegir el material y de dónde sale (stock general o a pie de máquina).",
            "Kg descartados (media bolsa de 25 kg = 12,5) y el motivo: se cayó o se rompió la bolsa, sucio o contaminado, mojado o en mal estado, u otro (con detalle).",
            "**«Registrar descarte»**: se descuenta del stock y queda en Movimientos como «Descarte».",
        ]),
        ("Ajuste de balanza", [
            "Operaciones de stock → «Ajuste de balanza»: material, dónde, si falta o sobra, kg y motivo (ej. la bolsa de 25 kg terminó con 24,65 kg).",
        ]),
        ("Recibir molienda", [
            "Molino → «Confirmar recepción en Materia Prima»: revisar el bolsón y **confirmar** (entra al stock con su código) o **rechazar**.",
        ]),
    ],
    [
        "«No alcanza para descontar»: el stock de esa ubicación es menor a lo que se quiere descontar; revisar si el material está en el depósito o a pie de máquina.",
        "El alta de un material nuevo la hace Supervisión o Gerencia.",
    ],
)

area(
    "Retiros de materia prima",
    "Retiros de MP (con PIN). También Materia prima, Encargado, Supervisor y Gerencia.",
    [
        "Llevar el material del depósito a la máquina (pie de máquina) para cada producción.",
        "Devolver lo que no se usó y registrar el sobrante mezclado.",
    ],
    [
        ("Retirar material", [
            "En la producción → **«Retirar materia prima a pie de máquina»** (o Materia prima → Stock a pie de máquina).",
            "Leer con el lector el código de cada bolsa; **«Agregar el material de la receta»** completa las cantidades.",
            "Confirmar: el material pasa del stock general al pie de máquina.",
        ]),
        ("Cerrar el retiro", [
            "En el retiro → **«Conciliar y cerrar retiro»**.",
            "Lo que vuelve sin mezclar: «Devolver sin mezclar». Lo mezclado con master: «Registrar sobrante», con su código.",
            "Se cierra con el pie de máquina en cero (una diferencia de balanza se justifica).",
        ]),
    ],
    [
        "El lector rechaza un código de producto terminado: sólo acepta lotes o códigos de materia prima.",
        "No se puede cerrar el retiro si queda material a pie de máquina sin devolver, registrar o justificar.",
    ],
)

area(
    "Compras",
    "Compras. También Supervisor y Gerencia. Materia prima, Encargado y Gerencia (consulta) sólo miran.",
    [
        "**Necesidad de materia prima:** lo que piden los pedidos y los mínimos, menos lo que hay y lo ya comprado.",
        "**Registrar compras** y seguir su estado; ver las compras en curso y el historial.",
        "Ver qué compras con demora o faltante ponen en riesgo una entrega.",
    ],
    [
        ("Registrar una compra", [
            "Compras → **«Registrar compra»**: material, kg, fecha del pedido, proveedor, N° de orden de compra y entrega estimada.",
            "Actualizar el estado con «Guardar cambios» a medida que avanza (el motivo del cambio queda en el historial).",
            "Cuando llega, Materia prima carga el ingreso de proveedor y lo imputa a la compra (el stock entra una sola vez).",
        ]),
    ],
    [
        "«No se pudieron calcular (falta configurar)»: productos sin receta o sin peso por pieza; lo completa el Encargado o Supervisión.",
    ],
)

area(
    "Matrices",
    "Matrices (con PIN). También Encargado, Supervisor y Gerencia. Gerencia (consulta) sólo mira.",
    [
        "Programar y registrar cambios de matriz, reparaciones y service.",
        "Ver lo programado y en curso; queda en el calendario de Producción.",
    ],
    [
        ("Programar una intervención", [
            "Matrices → elegir el tipo (cambio de matriz, reparación o service), la inyectora, la matriz, la fecha y turno, el responsable y una descripción → **«Programar»**.",
            "A medida que avanza, actualizar el estado → **«Guardar»**. El historial queda en la intervención.",
        ]),
    ],
    [],
)

area(
    "Molino",
    "Molino (con PIN). Materia prima confirma la recepción. También Supervisor y Gerencia.",
    [
        "Recibir el descarte de producción (coladas, piezas falladas).",
        "Entregar la molienda a Materia prima en bolsones con su código.",
    ],
    [
        ("Paso a paso", [
            "**«Recibir descarte»**: origen, material o composición, peso pesado en kg y, si se sabe, la producción → «Registrar descarte».",
            "Al moler: **«Entregar molienda a Materia Prima»**: bolsón o canasto, código de molienda y peso → «Entregar a MP».",
            "Materia prima pesa, confirma la recepción (entra al stock como bolsón con código) o la rechaza con el motivo.",
        ]),
    ],
    [],
)

area(
    "Supervisión y Gerencia",
    "Supervisor y Gerencia. Gerencia (consulta) ve todo, con precios, sin modificar.",
    [
        "Todo lo anterior, más **Inicio**: resumen de la operación (también a distancia).",
        "**Usuarios:** altas, bajas, perfiles, PIN y contraseñas. El Supervisor no modifica perfiles de Gerencia.",
        "**Correcciones** de datos ya cargados, siempre con motivo; resolver los errores informados y los reclamos.",
        "Alta de productos, colores y materiales nuevos; recetas, mínimos, parámetros.",
        "**Historial de cambios:** quién cambió qué, cuándo y por qué.",
    ],
    [
        ("Dar de alta a una persona", [
            "Administración → **Usuarios** → nuevo usuario: nombre y perfil principal (y otros perfiles si hace falta).",
            "Personal de oficina: email y contraseña. Personal de planta: PIN de 4 a 8 números (no necesita email).",
            "Para dar de baja: desactivar el usuario (su historial queda).",
        ]),
    ],
    [
        "Hasta que no se le carga un PIN o contraseña, el usuario queda «pendiente de activación» y no puede entrar.",
    ],
)

# Quitar el último salto de página.
body = doc.element.body
ultimo = body[-2] if body[-1].tag.endswith("sectPr") else body[-1]
body.remove(ultimo)

out = sys.argv[1]
doc.save(out)
print("ok", out)
