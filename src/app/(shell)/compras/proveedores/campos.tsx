import type { Proveedor } from "@/lib/data/proveedores";

/** Campos de la ficha del proveedor (alta y edición). */
export function CamposProveedor({ p }: { p?: Proveedor }) {
  const campo = (name: keyof Proveedor, label: string, extra: { placeholder?: string; type?: string; required?: boolean; ancho?: boolean } = {}) => (
    <label className={`campo ${extra.ancho ? "sm:col-span-2" : ""}`}>
      <span>
        {label}
        {extra.required ? " *" : ""}
      </span>
      <input name={name} type={extra.type ?? "text"} required={extra.required} defaultValue={(p?.[name] as string | null) ?? ""} placeholder={extra.placeholder} className="input" />
    </label>
  );
  return (
    <>
      {campo("nombre", "Nombre o razón social", { required: true })}
      {campo("cuit", "CUIT", { placeholder: "30-12345678-9" })}
      {campo("contacto", "Persona de contacto")}
      {campo("telefono", "Teléfono")}
      {campo("email", "Email", { type: "email" })}
      {campo("condicionPago", "Condición de pago", { placeholder: "Ej.: 30 días" })}
      {campo("direccion", "Dirección", { ancho: true })}
      {campo("observaciones", "Observaciones")}
    </>
  );
}
