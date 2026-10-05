CREATE TYPE "public"."estado_despacho" AS ENUM('ARMANDO', 'CONTROLADO', 'ENTREGADO', 'ANULADO');--> statement-breakpoint
CREATE TYPE "public"."estado_reclamo" AS ENUM('ABIERTO', 'EN_ANALISIS', 'CERRADO');--> statement-breakpoint
CREATE TYPE "public"."tipo_aviso" AS ENUM('PEDIDO_LISTO', 'RECLAMO_NUEVO', 'INFORME_RECLAMO');--> statement-breakpoint
CREATE TABLE "aviso" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" "tipo_aviso" NOT NULL,
	"destino_rol" "rol" NOT NULL,
	"mensaje" text NOT NULL,
	"pedido_id" integer,
	"despacho_id" integer,
	"reclamo_id" integer,
	"creado_por_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"visto_por_id" integer,
	"visto_en" timestamp with time zone,
	"procesado_por_id" integer,
	"procesado_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reclamo" (
	"id" serial PRIMARY KEY NOT NULL,
	"pedido_id" integer NOT NULL,
	"despacho_id" integer,
	"caja_id" integer,
	"partida_id" integer,
	"estado" "estado_reclamo" DEFAULT 'ABIERTO' NOT NULL,
	"descripcion" text NOT NULL,
	"motivo_devolucion" "motivo_devolucion",
	"causa" text,
	"solucion" text,
	"observaciones" text,
	"supervisor_id" integer,
	"creado_por_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"cerrado_por_id" integer,
	"cerrado_en" timestamp with time zone,
	"informe_enviado_por_id" integer,
	"informe_enviado_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reclamo_evento" (
	"id" serial PRIMARY KEY NOT NULL,
	"reclamo_id" integer NOT NULL,
	"tipo" text NOT NULL,
	"detalle" text,
	"usuario_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "despacho" ALTER COLUMN "numero_interno" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "despacho" ALTER COLUMN "numero_interno" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dosificacion_master" ALTER COLUMN "kg_por_kg_mp" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retiro_mp" ALTER COLUMN "lote_mp_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "estado" "estado_despacho" DEFAULT 'ENTREGADO' NOT NULL;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "creado_por_id" integer;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "control1_por_id" integer;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "control1_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "control1_resultado" text;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "control_final_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "control_final_resultado" text;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "entregado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "remito_legal_por_id" integer;--> statement-breakpoint
ALTER TABLE "despacho" ADD COLUMN "remito_legal_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dosificacion_master" ADD COLUMN "g_por_kg_mp" numeric(10, 5);--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD COLUMN "materia_prima_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD COLUMN "ciclo_id" integer;--> statement-breakpoint
ALTER TABLE "aviso" ADD CONSTRAINT "aviso_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aviso" ADD CONSTRAINT "aviso_despacho_id_despacho_id_fk" FOREIGN KEY ("despacho_id") REFERENCES "public"."despacho"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aviso" ADD CONSTRAINT "aviso_reclamo_id_reclamo_id_fk" FOREIGN KEY ("reclamo_id") REFERENCES "public"."reclamo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aviso" ADD CONSTRAINT "aviso_creado_por_id_usuario_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aviso" ADD CONSTRAINT "aviso_visto_por_id_usuario_id_fk" FOREIGN KEY ("visto_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aviso" ADD CONSTRAINT "aviso_procesado_por_id_usuario_id_fk" FOREIGN KEY ("procesado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamo" ADD CONSTRAINT "reclamo_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamo" ADD CONSTRAINT "reclamo_despacho_id_despacho_id_fk" FOREIGN KEY ("despacho_id") REFERENCES "public"."despacho"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamo" ADD CONSTRAINT "reclamo_caja_id_caja_id_fk" FOREIGN KEY ("caja_id") REFERENCES "public"."caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamo" ADD CONSTRAINT "reclamo_partida_id_partida_id_fk" FOREIGN KEY ("partida_id") REFERENCES "public"."partida"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamo" ADD CONSTRAINT "reclamo_supervisor_id_usuario_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamo" ADD CONSTRAINT "reclamo_creado_por_id_usuario_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamo" ADD CONSTRAINT "reclamo_cerrado_por_id_usuario_id_fk" FOREIGN KEY ("cerrado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamo" ADD CONSTRAINT "reclamo_informe_enviado_por_id_usuario_id_fk" FOREIGN KEY ("informe_enviado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamo_evento" ADD CONSTRAINT "reclamo_evento_reclamo_id_reclamo_id_fk" FOREIGN KEY ("reclamo_id") REFERENCES "public"."reclamo"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reclamo_evento" ADD CONSTRAINT "reclamo_evento_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "aviso_destino_idx" ON "aviso" USING btree ("destino_rol","procesado_en");--> statement-breakpoint
CREATE INDEX "reclamo_pedido_idx" ON "reclamo" USING btree ("pedido_id");--> statement-breakpoint
CREATE INDEX "reclamo_estado_idx" ON "reclamo" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "reclamo_evento_idx" ON "reclamo_evento" USING btree ("reclamo_id","creado_en");--> statement-breakpoint
ALTER TABLE "despacho" ADD CONSTRAINT "despacho_creado_por_id_usuario_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despacho" ADD CONSTRAINT "despacho_control1_por_id_usuario_id_fk" FOREIGN KEY ("control1_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despacho" ADD CONSTRAINT "despacho_remito_legal_por_id_usuario_id_fk" FOREIGN KEY ("remito_legal_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD CONSTRAINT "retiro_mp_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD CONSTRAINT "retiro_mp_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Definición del cliente (05/10/2026): la dosificación es en GRAMOS de master por kg de materia prima.
-- Los valores cargados (0,015 / 0,012 / 0,018) son los mismos; cambia la unidad.
UPDATE "dosificacion_master" SET "g_por_kg_mp" = "kg_por_kg_mp" WHERE "g_por_kg_mp" IS NULL;--> statement-breakpoint
INSERT INTO "auditoria_config" ("entidad", "entidad_id", "campo", "valor_anterior", "valor_nuevo", "motivo", "usuario_id")
SELECT 'dosificacion_master', d."id"::text, 'unidad', d."kg_por_kg_mp"::text || ' kg/kg', d."kg_por_kg_mp"::text || ' g/kg',
       'Definición del cliente: la unidad es gramos de master por kg de materia prima (el kg/kg del Word era un error de tipeo)',
       u."id"
FROM "dosificacion_master" d
CROSS JOIN (SELECT min("id") AS "id" FROM "usuario" WHERE "nombre" = 'Importación (sistema)') u
WHERE u."id" IS NOT NULL;
