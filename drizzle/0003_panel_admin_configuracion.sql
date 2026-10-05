CREATE SEQUENCE "public"."remito_interno_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "auditoria_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"entidad" text NOT NULL,
	"entidad_id" text NOT NULL,
	"campo" text NOT NULL,
	"valor_anterior" text,
	"valor_nuevo" text,
	"motivo" text,
	"usuario_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dosificacion_master" (
	"id" serial PRIMARY KEY NOT NULL,
	"familia" "familia" NOT NULL,
	"color_id" integer,
	"materia_prima_base_id" integer,
	"kg_por_kg_mp" numeric(8, 5) NOT NULL,
	"observaciones" text,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por_id" integer,
	CONSTRAINT "dosificacion_master_uq" UNIQUE NULLS NOT DISTINCT("familia","color_id")
);
--> statement-breakpoint
CREATE TABLE "parametro" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" numeric(14, 4) NOT NULL,
	"descripcion" text NOT NULL,
	"unidad" text,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por_id" integer
);
--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "clave" text GENERATED ALWAYS AS (lower(regexp_replace(btrim(translate(nombre, 'ÁÉÍÓÚÜáéíóúü', 'AEIOUUaeiouu')), '\s+', ' ', 'g'))) STORED;--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "especial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "cliente_id" integer;--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "proveedor_master_id" integer;--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "master_nombre" text;--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "master_codigo" text;--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "master_materia_prima_id" integer;--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "observaciones" text;--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "creado_en" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "creado_por_id" integer;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "numero_interno" integer DEFAULT nextval('remito_interno_seq') NOT NULL;--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "codigo_barras" text;--> statement-breakpoint
ALTER TABLE "auditoria_config" ADD CONSTRAINT "auditoria_config_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosificacion_master" ADD CONSTRAINT "dosificacion_master_color_id_color_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."color"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosificacion_master" ADD CONSTRAINT "dosificacion_master_materia_prima_base_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_base_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dosificacion_master" ADD CONSTRAINT "dosificacion_master_actualizado_por_id_usuario_id_fk" FOREIGN KEY ("actualizado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parametro" ADD CONSTRAINT "parametro_actualizado_por_id_usuario_id_fk" FOREIGN KEY ("actualizado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auditoria_config_entidad_idx" ON "auditoria_config" USING btree ("entidad","entidad_id","creado_en");--> statement-breakpoint
ALTER TABLE "color" ADD CONSTRAINT "color_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "color" ADD CONSTRAINT "color_proveedor_master_id_proveedor_master_id_fk" FOREIGN KEY ("proveedor_master_id") REFERENCES "public"."proveedor_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "color" ADD CONSTRAINT "color_master_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("master_materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "color" ADD CONSTRAINT "color_creado_por_id_usuario_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cliente_nombre_normalizado_uq" ON "cliente" USING btree (lower(btrim("nombre")));--> statement-breakpoint
CREATE UNIQUE INDEX "color_clave_uq" ON "color" USING btree ("clave");--> statement-breakpoint
ALTER TABLE "despacho" ADD CONSTRAINT "despacho_numero_interno_unique" UNIQUE("numero_interno");--> statement-breakpoint
INSERT INTO "parametro" ("clave", "valor", "descripcion", "unidad") VALUES
  ('semaforo_margen_bajo', 0.15, 'Margen por encima del mínimo dentro del cual el semáforo marca "Bajo". 0,15 = hasta un 15% por encima del mínimo. Era el valor fijo en el código hasta esta versión.', 'fracción'),
  ('unidades_por_caja_pisos', 25, 'Unidades por caja cerrada para todos los pisos, sin importar modelo ni color. Los accesorios no se embalan hasta el momento de la venta.', 'unidades')
ON CONFLICT ("clave") DO NOTHING;
