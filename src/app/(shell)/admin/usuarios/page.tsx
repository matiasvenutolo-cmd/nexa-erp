import { listarUsuariosAdmin, type FilaUsuarioAdmin } from "@/lib/data/usuarios";
import { actualizarUsuarioAction, cambiarSecretoAction, crearUsuarioAction } from "@/app/actions/admin";
import { ROL_LABEL } from "@/lib/nav";
import { rolEnum } from "@/lib/db/schema";
import { ROLES_CON_PIN, puedeAdministrarUsuarios, puedeOtorgarRol } from "@/lib/auth/permisos";
import { Aviso, BOTON, TD, TH, exigirSeccion } from "../comunes";

type Rol = FilaUsuarioAdmin["rol"];
const VOLVER = "/admin/usuarios";
const ACCESO: Record<FilaUsuarioAdmin["accede"], string> = {
  contraseña: "Email y contraseña",
  PIN: "Nombre y PIN",
  "contraseña y PIN": "Contraseña y PIN",
  pendiente: "Pendiente de activación",
};

export default async function AdminUsuariosPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const actual = await exigirSeccion("/admin/usuarios");
  const sp = await searchParams;
  // Administración sólo administra operarios (usuarios de taller, con PIN).
  const soloOperarios = !puedeAdministrarUsuarios(actual.rol);
  const usuarios = await listarUsuariosAdmin(soloOperarios);
  const otorgables = rolEnum.enumValues.filter((r) => puedeOtorgarRol(actual.rol, r));
  const pendientes = usuarios.filter((u) => u.activo && u.accede === "pendiente").length;

  return (
    <div className="space-y-4">
      <Aviso ok={sp.ok} error={sp.error} />
      <p className="text-sm text-foreground-muted">
        {soloOperarios
          ? "Usuarios de taller: entran desde la PC de planta eligiendo su nombre y su PIN. Los demás usuarios los administra Supervisión. Un usuario dado de baja no puede entrar, pero su historial se conserva."
          : "Los permisos salen del perfil. Oficina, supervisión y gerencia entran con email y contraseña; los perfiles de planta (Operario, Retiros de MP, Despacho, Molino, Matrices) también pueden entrar con nombre y PIN, sin email. Una persona puede tener perfiles adicionales y elegir con cuál trabaja. Un usuario dado de baja no puede entrar, pero su historial se conserva."}
      </p>
      {pendientes > 0 && (
        <p className="aviso aviso-alerta text-sm">
          {pendientes === 1 ? "Hay 1 usuario pendiente de activación" : `Hay ${pendientes} usuarios pendientes de activación`}: no puede entrar hasta que se le cargue una contraseña o un PIN (abrí el usuario).
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-foreground-muted">
                <th className={TH}>Usuario</th>
                <th className={TH}>Perfil</th>
                <th className={TH}>Estado</th>
                <th className={TH}>Acceso</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.length === 0 && (
                <tr>
                  <td colSpan={4} className={`${TD} text-foreground-muted`}>
                    Todavía no hay usuarios de taller.
                  </td>
                </tr>
              )}
              {usuarios.map((u) => (
                <FilaUsuario key={u.id} u={u} esUsted={u.id === actual.id} soloOperarios={soloOperarios} otorgables={otorgables} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <details className="rounded-lg border border-border bg-surface p-4">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          {soloOperarios ? "Dar de alta un usuario de taller" : "Dar de alta un usuario"}
        </summary>
        <form action={crearUsuarioAction} className="mt-3 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="volver" value={VOLVER} />
          <Campo label="Nombre *">
            <input name="nombre" required className="input" />
          </Campo>
          {soloOperarios ? (
            <>
              <input type="hidden" name="rol" value="OPERARIO" />
              <input type="hidden" name="soloOperario" value="1" />
              <Campo label="PIN (4 a 8 números) *">
                <input name="secreto" inputMode="numeric" pattern="[0-9]{4,8}" required className="input" autoComplete="off" />
              </Campo>
            </>
          ) : (
            <>
              <Campo label="Email (no hace falta para entrar con PIN)">
                <input name="email" type="email" className="input" />
              </Campo>
              <Campo label="Perfil principal *">
                <SelectRol roles={otorgables} />
              </Campo>
              <Campo label="Contraseña (8 o más; opcional)">
                <input name="password" type="password" minLength={8} className="input" autoComplete="new-password" />
              </Campo>
              <Campo label="PIN (4 a 8 números; sólo perfiles de planta; opcional)">
                <input name="pin" inputMode="numeric" pattern="[0-9]{4,8}" className="input" autoComplete="off" />
              </Campo>
              <div className="sm:col-span-2">
                <Adicionales roles={otorgables} />
              </div>
              <p className="text-xs text-foreground-muted sm:col-span-2">
                Sin contraseña ni PIN la cuenta queda creada pero pendiente de activación: se la carga después quien administra usuarios. No se generan claves automáticas.
              </p>
            </>
          )}
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

function FilaUsuario({ u, esUsted, soloOperarios, otorgables }: { u: FilaUsuarioAdmin; esUsted: boolean; soloOperarios: boolean; otorgables: Rol[] }) {
  const editable = soloOperarios || [u.rol, ...u.rolesAdicionales].every((r) => otorgables.includes(r));
  const conPin = [u.rol, ...u.rolesAdicionales].some((r) => ROLES_CON_PIN.includes(r));
  return (
    <tr id={`u-${u.id}`} className="border-b border-border last:border-0">
      <td className={TD}>
        <details>
          <summary className="cursor-pointer font-medium text-foreground">
            {u.nombre}
            {esUsted && <span className="ml-1 text-xs text-foreground-muted">(vos)</span>}
          </summary>
          {!editable ? (
            <p className="mt-2 text-xs text-foreground-muted">Los perfiles de Gerencia sólo los modifica Gerencia.</p>
          ) : (
            <div className="mt-3 grid w-[min(42rem,85vw)] gap-4">
              <form action={actualizarUsuarioAction} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="id" value={u.id} />
                <input type="hidden" name="volver" value={VOLVER} />
                <input type="hidden" name="ancla" value={`u-${u.id}`} />
                <Campo label="Nombre">
                  <input name="nombre" defaultValue={u.nombre} required className="input" />
                </Campo>
                {soloOperarios ? (
                  <input type="hidden" name="rol" value="OPERARIO" />
                ) : (
                  <>
                    <Campo label="Email">
                      <input name="email" type="email" defaultValue={u.email ?? ""} className="input" />
                    </Campo>
                    <Campo label="Perfil principal">
                      <SelectRol valor={u.rol} roles={otorgables} />
                    </Campo>
                  </>
                )}
                <Campo label="Estado">
                  <select name="activo" defaultValue={u.activo ? "1" : "0"} className="input">
                    <option value="1">Activo</option>
                    <option value="0">Dado de baja</option>
                  </select>
                </Campo>
                {!soloOperarios && (
                  <div className="sm:col-span-2">
                    <input type="hidden" name="conAdicionales" value="1" />
                    <Adicionales roles={otorgables} marcados={u.rolesAdicionales} />
                  </div>
                )}
                <div>
                  <button type="submit" className={BOTON}>
                    Guardar
                  </button>
                </div>
              </form>
              <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2">
                {!soloOperarios && (
                  <Secreto id={u.id} tipo="contraseña" tiene={u.tieneClave} deshabilitado={!u.email ? "Primero cargale un email." : null} />
                )}
                {conPin && <Secreto id={u.id} tipo="PIN" tiene={u.tienePin} deshabilitado={null} />}
              </div>
            </div>
          )}
        </details>
        {u.email && <div className="text-xs text-foreground-muted">{u.email}</div>}
      </td>
      <td className={TD}>
        {ROL_LABEL[u.rol]}
        {u.rolesAdicionales.length > 0 && <div className="text-xs text-foreground-muted">+ {u.rolesAdicionales.map((r) => ROL_LABEL[r]).join(", ")}</div>}
      </td>
      <td className={TD}>
        <span className={`badge-estado ${u.activo ? "badge-ok" : "bg-surface-muted text-foreground-muted"}`}>{u.activo ? "Activo" : "Baja"}</span>
      </td>
      <td className={TD}>
        <span className={u.accede === "pendiente" && u.activo ? "font-semibold text-[var(--estado-bajo-fg)]" : ""}>{ACCESO[u.accede]}</span>
      </td>
    </tr>
  );
}

function Secreto({ id, tipo, tiene, deshabilitado }: { id: number; tipo: "contraseña" | "PIN"; tiene: boolean; deshabilitado: string | null }) {
  const accion = `${tiene ? "Restablecer" : "Cargar"} ${tipo}`;
  return (
    <form action={cambiarSecretoAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="volver" value={VOLVER} />
      <input type="hidden" name="tipo" value={tipo} />
      <Campo label={tipo === "PIN" ? "PIN (4 a 8 números)" : "Contraseña (8 o más)"}>
        <input
          name="secreto"
          type="password"
          required
          disabled={Boolean(deshabilitado)}
          inputMode={tipo === "PIN" ? "numeric" : undefined}
          pattern={tipo === "PIN" ? "[0-9]{4,8}" : undefined}
          minLength={tipo === "PIN" ? undefined : 8}
          className="input w-44"
          autoComplete="new-password"
        />
      </Campo>
      <button type="submit" disabled={Boolean(deshabilitado)} className="rounded-md bg-surface-muted px-3 py-1.5 text-sm font-medium text-foreground disabled:opacity-50">
        {accion}
      </button>
      {deshabilitado && <span className="text-xs text-foreground-muted">{deshabilitado}</span>}
    </form>
  );
}

function Adicionales({ roles, marcados = [] }: { roles: Rol[]; marcados?: Rol[] }) {
  return (
    <fieldset className="text-sm">
      <legend className="mb-1 text-foreground-muted">Perfiles adicionales (la persona elige con cuál trabaja)</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {roles.map((r) => (
          <label key={r} className="flex items-center gap-1.5">
            <input type="checkbox" name="rolesAdicionales" value={r} defaultChecked={marcados.includes(r)} />
            {ROL_LABEL[r]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function SelectRol({ valor, roles }: { valor?: string; roles: Rol[] }) {
  return (
    <select name="rol" defaultValue={valor ?? ""} required className="input">
      {!valor && <option value="">Elegí un perfil…</option>}
      {roles.map((r) => (
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
