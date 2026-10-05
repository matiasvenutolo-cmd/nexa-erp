import { listarUsuariosAdmin, type FilaUsuarioAdmin } from "@/lib/data/usuarios";
import { actualizarUsuarioAction, cambiarSecretoAction, crearUsuarioAction } from "@/app/actions/admin";
import { ROL_LABEL } from "@/lib/nav";
import { rolEnum } from "@/lib/db/schema";
import { Aviso, BOTON, TD, TH, exigirSeccion } from "../comunes";

const VOLVER = "/admin/usuarios";

export default async function AdminUsuariosPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const actual = await exigirSeccion("/admin/usuarios");
  const sp = await searchParams;
  const usuarios = await listarUsuariosAdmin();

  return (
    <div className="space-y-4">
      <Aviso ok={sp.ok} error={sp.error} />
      <p className="text-sm text-foreground-muted">
        Los permisos salen del rol: de supervisor para abajo nadie ve precios. Los operarios entran con PIN; el
        resto, con email y contraseña. Un usuario dado de baja no puede entrar, pero su historial se conserva.
      </p>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                <th className={TH}>Usuario</th>
                <th className={TH}>Rol</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Acceso</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map((u) => (
                <FilaUsuario key={u.id} u={u} esUsted={u.id === actual.id} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="rounded-lg border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">Dar de alta un usuario</summary>
        <form action={crearUsuarioAction} className="mt-3 grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="volver" value={VOLVER} />
          <Campo label="Nombre *">
            <input name="nombre" required className="input" />
          </Campo>
          <Campo label="Email (no hace falta para operarios)">
            <input name="email" type="email" className="input" />
          </Campo>
          <Campo label="Rol *">
            <SelectRol />
          </Campo>
          <Campo label="Contraseña (8+) o PIN (4-8 números) *">
            <input name="secreto" type="password" required className="input" autoComplete="new-password" />
          </Campo>
          <div>
            <button type="submit" className={BOTON}>
              Dar de alta
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

function FilaUsuario({ u, esUsted }: { u: FilaUsuarioAdmin; esUsted: boolean }) {
  return (
    <tr id={`u-${u.id}`} className="border-b border-border last:border-0">
      <td className={TD}>
        <details>
          <summary className="cursor-pointer font-medium text-foreground">
            {u.nombre}
            {esUsted && <span className="ml-1 text-xs text-foreground-muted">(vos)</span>}
          </summary>
          <div className="mt-3 grid w-[min(40rem,85vw)] gap-4">
            <form action={actualizarUsuarioAction} className="grid gap-2 sm:grid-cols-2">
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="volver" value={VOLVER} />
              <input type="hidden" name="ancla" value={`u-${u.id}`} />
              <Campo label="Nombre">
                <input name="nombre" defaultValue={u.nombre} required className="input" />
              </Campo>
              <Campo label="Email">
                <input name="email" type="email" defaultValue={u.email ?? ""} className="input" />
              </Campo>
              <Campo label="Rol">
                <SelectRol valor={u.rol} />
              </Campo>
              <Campo label="Estado">
                <select name="activo" defaultValue={u.activo ? "1" : "0"} className="input">
                  <option value="1">Activo</option>
                  <option value="0">Dado de baja</option>
                </select>
              </Campo>
              <div>
                <button type="submit" className={BOTON}>
                  Guardar
                </button>
              </div>
            </form>
            <form action={cambiarSecretoAction} className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="volver" value={VOLVER} />
              <input type="hidden" name="tipo" value={u.accede === "PIN" ? "PIN" : "contraseña"} />
              <Campo label={u.accede === "PIN" ? "Nuevo PIN" : "Nueva contraseña"}>
                <input name="secreto" type="password" required className="input w-56" autoComplete="new-password" />
              </Campo>
              <button type="submit" className="rounded-md bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground">
                Cambiar {u.accede === "PIN" ? "PIN" : "contraseña"}
              </button>
            </form>
          </div>
        </details>
        {u.email && <div className="text-xs text-foreground-muted">{u.email}</div>}
      </td>
      <td className={TD}>{ROL_LABEL[u.rol]}</td>
      <td className={TD}>
        <span className={`badge-estado ${u.activo ? "badge-ok" : "bg-surface-muted text-foreground-muted"}`}>
          {u.activo ? "Activo" : "Baja"}
        </span>
      </td>
      <td className={TD}>{u.accede}</td>
    </tr>
  );
}

function SelectRol({ valor }: { valor?: string }) {
  return (
    <select name="rol" defaultValue={valor ?? ""} required className="input">
      {!valor && <option value="">Elegí un rol…</option>}
      {rolEnum.enumValues.map((r) => (
        <option key={r} value={r}>
          {ROL_LABEL[r]}
        </option>
      ))}
    </select>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-foreground-muted">{label}</span>
      {children}
    </label>
  );
}
