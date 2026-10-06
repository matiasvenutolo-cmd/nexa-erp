import Link from "next/link";
import { redirect } from "next/navigation";
import {
  pedidosDeCliente,
  trazarCaja,
  trazarCertificado,
  trazarLote,
  lotesConNumero,
  trazarPartida,
  trazarPedido,
  type Destino,
  type OrigenPartida,
} from "@/lib/data/trazabilidad";
import { ESTADO_LABEL } from "@/lib/data/pedidos";
import { getUsuarioActual } from "@/lib/session";
import { puedeVerTrazabilidad } from "@/lib/auth/permisos";
import { fmtFecha, fmtFechaHora, fmtNumero } from "@/lib/format";

const TIPOS = [
  { v: "pedido", label: "N° de pedido" },
  { v: "cliente", label: "Cliente" },
  { v: "caja", label: "Código de caja" },
  { v: "partida", label: "N° de partida" },
  { v: "lote", label: "Lote de MP (código o N°)" },
  { v: "certificado", label: "N° de certificado" },
] as const;

type Tipo = (typeof TIPOS)[number]["v"];

export default async function TrazabilidadPage({ searchParams }: { searchParams: Promise<{ tipo?: Tipo; valor?: string }> }) {
  const usuario = await getUsuarioActual();
  if (!puedeVerTrazabilidad(usuario.rol)) redirect("/tablero");
  const sp = await searchParams;
  const tipo: Tipo = TIPOS.some((t) => t.v === sp.tipo) ? sp.tipo! : "pedido";
  const valor = sp.valor?.trim() ?? "";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-brand-azul-oscuro">Trazabilidad</h1>
        <p className="mt-1 text-sm text-foreground-muted">
          Hacia atrás (cliente → caja → partida → lote → certificado) y hacia adelante (certificado o lote → partidas → cajas →
          clientes). Sirve para investigar reclamos y lotes fallados.
        </p>
      </div>
      <form action="/trazabilidad" className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-surface p-4">
        <label className="block text-sm">
          <span className="mb-1 block text-foreground-muted">Buscar por</span>
          <select name="tipo" defaultValue={tipo} className="input w-56">
            {TIPOS.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block flex-1 text-sm">
          <span className="mb-1 block text-foreground-muted">Valor</span>
          <input name="valor" defaultValue={valor} required className="input font-mono" />
        </label>
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:opacity-90">
          Rastrear
        </button>
      </form>
      {valor && <Resultado tipo={tipo} valor={valor} />}
    </div>
  );
}

async function Resultado({ tipo, valor }: { tipo: Tipo; valor: string }) {
  const sinResultado = <p className="text-sm text-foreground-muted">No se encontró nada para “{valor}”.</p>;

  if (tipo === "cliente") {
    const pedidos = await pedidosDeCliente(valor);
    if (pedidos.length === 0) return sinResultado;
    return (
      <Bloque titulo="Pedidos del cliente">
        <ul className="space-y-1">
          {pedidos.map((p) => (
            <li key={p.pedidoId}>
              <Enlace tipo="pedido" valor={p.pedidoId}>
                Pedido #{p.pedidoId}
              </Enlace>{" "}
              · {p.clienteNombre} · {fmtFecha(p.fecha)} · {ESTADO_LABEL[p.estado]}
            </li>
          ))}
        </ul>
      </Bloque>
    );
  }

  if (tipo === "pedido") {
    const t = Number.isFinite(Number(valor.replace("#", ""))) ? await trazarPedido(Number(valor.replace("#", ""))) : null;
    if (!t) return sinResultado;
    return (
      <>
        <Bloque titulo={`Pedido #${t.pedido.id} · ${t.pedido.clienteNombre} · ${ESTADO_LABEL[t.pedido.estado]}`}>
          <Link href={`/pedidos/${t.pedido.id}`} className="text-accent hover:underline">
            Abrir pedido
          </Link>
        </Bloque>
        <Destinos destinos={t.entregas} titulo="Qué recibió el cliente" />
        {t.unidadesSinPartida > 0 && (
          <p className="text-sm text-foreground-muted">
            {fmtNumero(t.unidadesSinPartida, 0)} unidades salieron del stock anterior a las cajas: no tienen partida asociada.
          </p>
        )}
        <Origen partidas={t.origen} />
      </>
    );
  }

  if (tipo === "caja") {
    const t = await trazarCaja(valor);
    if (!t) return sinResultado;
    return (
      <>
        <Bloque titulo={`Caja ${t.caja.codigoBarra}`}>
          {t.caja.cantidad} unidades · {t.caja.estado} · {fmtFecha(t.caja.fecha)}
        </Bloque>
        <Destinos destinos={t.destinos} titulo="A quién se entregó" />
        <Origen partidas={t.origen ? [t.origen] : []} />
      </>
    );
  }

  if (tipo === "partida") {
    const t = Number.isFinite(Number(valor)) ? await trazarPartida(Number(valor)) : null;
    if (!t || !t.origen) return sinResultado;
    return (
      <>
        <Origen partidas={[t.origen]} />
        <Cajas cajas={t.cajas} />
        <Destinos destinos={t.destinos} titulo="Clientes que recibieron cajas de esta partida" />
      </>
    );
  }

  if (tipo === "lote") {
    const t = await trazarLote(valor);
    if (!t) {
      const varios = await lotesConNumero(valor);
      if (varios.length < 2) return sinResultado;
      return (
        <Bloque titulo={`Hay ${varios.length} lotes con el número ${valor}: elegí el código completo`}>
          <ul className="mt-1 space-y-1">
            {varios.map((v) => (
              <li key={v.codigoBarra}>
                <Link href={`/trazabilidad?tipo=lote&valor=${v.codigoBarra}`} className="font-mono text-accent hover:underline">
                  {v.codigoBarra}
                </Link>{" "}
                · {v.materiaPrimaNombre}
              </li>
            ))}
          </ul>
        </Bloque>
      );
    }
    return <TrazaLote t={t} />;
  }

  const t = Number.isFinite(Number(valor)) ? await trazarCertificado(Number(valor)) : null;
  if (!t) return sinResultado;
  return (
    <>
      <Bloque titulo={`Certificado N° ${t.certificado.numero} · ${t.certificado.proveedor}`}>
        {t.certificado.materiaPrimaNombre} · recibido {fmtFecha(t.certificado.fechaRecepcion)}
        {t.certificado.archivoUrl && (
          <>
            {" · "}
            <a href={t.certificado.archivoUrl} className="text-accent hover:underline" target="_blank" rel="noreferrer">
              ver certificado
            </a>
          </>
        )}
      </Bloque>
      {t.lotes.length === 0 && <p className="text-sm text-foreground-muted">El certificado no tiene lotes asociados.</p>}
      {t.lotes.map((l) => (
        <TrazaLote key={l.lote.id} t={l} />
      ))}
    </>
  );
}

function TrazaLote({ t }: { t: NonNullable<Awaited<ReturnType<typeof trazarLote>>> }) {
  return (
    <>
      <Bloque titulo={`Lote ${t.lote.numeroLote} · ${t.lote.materiaPrimaNombre}`}>
        <span className="font-mono text-xs">{t.lote.codigoBarra}</span> · ingresó {fmtFecha(t.lote.fechaIngreso)} ·{" "}
        {fmtNumero(t.lote.cantidadIngresada, 3)} kg ·{" "}
        {t.lote.certificadoNumero ? (
          <Enlace tipo="certificado" valor={t.lote.certificadoNumero}>
            Certificado N° {t.lote.certificadoNumero} ({t.lote.proveedor})
          </Enlace>
        ) : (
          "sin certificado"
        )}
        {t.usos.length > 0 && (
          <div className="mt-1 text-foreground-muted">
            Usado en {t.usos.length} ciclo(s): {t.usos.map((u) => `#${u.cicloId} (${fmtNumero(u.kg, 3)} kg)`).join(", ")}
          </div>
        )}
      </Bloque>
      <Origen partidas={t.partidas} titulo="Partidas que usaron este lote" />
      <Cajas cajas={t.cajas} />
      <Destinos destinos={t.destinos} titulo="Clientes que recibieron cajas de esas partidas" />
    </>
  );
}

function Origen({ partidas, titulo = "De dónde salió (partidas, producción y materia prima)" }: { partidas: OrigenPartida[]; titulo?: string }) {
  if (partidas.length === 0) return null;
  return (
    <Bloque titulo={titulo}>
      <div className="space-y-3">
        {partidas.map((p) => (
          <div key={p.partidaId}>
            <div className="font-medium">
              <Enlace tipo="partida" valor={p.numero}>
                Partida N° {p.numero}
              </Enlace>{" "}
              · {p.productoCodigo} · {fmtFecha(p.fechaApertura)}
              {p.fechaCierre ? ` a ${fmtFecha(p.fechaCierre)}` : " (abierta)"}
            </div>
            <div className="text-foreground-muted">
              Producción:{" "}
              {p.ciclos.map((c) => (
                <span key={c.id} className="mr-2">
                  <Link href={`/produccion/${c.id}`} className="text-accent hover:underline">
                    ciclo #{c.id}
                  </Link>{" "}
                  {fmtFecha(c.fechaInicio)} iny. {c.inyectora}
                  {c.piezasEntregadas != null && ` (${c.piezasEntregadas} a stock)`}
                </span>
              ))}
            </div>
            {p.materiales.length === 0 ? (
              <div className="text-foreground-muted">Sin materia prima registrada para esta partida.</div>
            ) : (
              <ul className="text-foreground-muted">
                {p.materiales.map((m, i) => (
                  <li key={i}>
                    {m.materiaPrimaNombre} · {fmtNumero(m.kg, 3)} kg ·{" "}
                    {m.loteCodigo ? (
                      <Enlace tipo="lote" valor={m.loteCodigo}>
                        <span className="font-mono text-xs">{m.codigoUso ?? m.loteCodigo}</span>
                      </Enlace>
                    ) : (
                      "stock sin lote"
                    )}
                    {m.certificadoNumero && (
                      <>
                        {" · "}
                        <Enlace tipo="certificado" valor={m.certificadoNumero}>
                          certificado N° {m.certificadoNumero} ({m.proveedor})
                        </Enlace>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </Bloque>
  );
}

function Destinos({ destinos, titulo }: { destinos: Destino[]; titulo: string }) {
  return (
    <Bloque titulo={titulo}>
      {destinos.length === 0 ? (
        <p className="text-foreground-muted">Nada entregado todavía.</p>
      ) : (
        <ul className="space-y-1">
          {destinos.map((d, i) => (
            <li key={i}>
              {d.cajaCodigo ? (
                <Enlace tipo="caja" valor={d.cajaCodigo}>
                  <span className="font-mono text-xs">{d.cajaCodigo}</span>
                </Enlace>
              ) : (
                <span className="text-foreground-muted">{d.productoCodigo} (sin caja)</span>
              )}{" "}
              · {fmtNumero(d.unidades, 0)} u. →{" "}
              <Enlace tipo="pedido" valor={d.pedidoId}>
                pedido #{d.pedidoId}
              </Enlace>{" "}
              · {d.clienteNombre} · remito {d.remitoInterno}
              {d.remitoLegal ? ` / legal ${d.remitoLegal}` : ""}
              {d.entregadoEn && ` · ${fmtFechaHora(d.entregadoEn)}`}
            </li>
          ))}
        </ul>
      )}
    </Bloque>
  );
}

function Cajas({ cajas }: { cajas: { id: number; codigo: string; cantidad: number; estado: string }[] }) {
  if (cajas.length === 0) return null;
  return (
    <Bloque titulo={`Cajas (${cajas.length})`}>
      <div className="flex flex-wrap gap-2">
        {cajas.map((c) => (
          <Enlace key={c.id} tipo="caja" valor={c.codigo}>
            <span className="rounded bg-surface-muted px-2 py-0.5 font-mono text-xs">
              {c.codigo} · {c.cantidad} · {c.estado}
            </span>
          </Enlace>
        ))}
      </div>
    </Bloque>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 text-sm">
      <h2 className="mb-2 font-semibold">{titulo}</h2>
      {children}
    </section>
  );
}

function Enlace({ tipo, valor, children }: { tipo: Tipo; valor: string | number; children: React.ReactNode }) {
  return (
    <Link href={`/trazabilidad?tipo=${tipo}&valor=${encodeURIComponent(String(valor))}`} className="text-accent hover:underline">
      {children}
    </Link>
  );
}
