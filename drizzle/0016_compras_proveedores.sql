CREATE TABLE "proveedor" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"cuit" text,
	"contacto" text,
	"telefono" text,
	"email" text,
	"direccion" text,
	"condicion_pago" text,
	"observaciones" text,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proveedor_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
ALTER TABLE "compra_mp" ADD COLUMN "proveedor_id" integer;--> statement-breakpoint
ALTER TABLE "compra_mp" ADD COLUMN "precio_kg" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "compra_mp" ADD COLUMN "monto_total" numeric(16, 2);--> statement-breakpoint
ALTER TABLE "compra_mp" ADD COLUMN "moneda" text DEFAULT 'ARS' NOT NULL;--> statement-breakpoint
ALTER TABLE "materia_prima" ADD COLUMN "aviso_compra_kg" numeric(12, 3);--> statement-breakpoint
ALTER TABLE "compra_mp" ADD CONSTRAINT "compra_mp_proveedor_id_proveedor_id_fk" FOREIGN KEY ("proveedor_id") REFERENCES "public"."proveedor"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Los proveedores que ya figuran en compras pasan a la ficha y se vinculan (no se borra el texto).
INSERT INTO "proveedor" ("nombre") SELECT DISTINCT trim("proveedor") FROM "compra_mp" WHERE "proveedor" IS NOT NULL AND trim("proveedor") <> '' ON CONFLICT ("nombre") DO NOTHING;--> statement-breakpoint
UPDATE "compra_mp" c SET "proveedor_id" = p."id" FROM "proveedor" p WHERE c."proveedor_id" IS NULL AND trim(c."proveedor") = p."nombre";
