CREATE TYPE "public"."esquema_turno" AS ENUM('SIMPLE', 'DOBLE', 'TRIPLE');--> statement-breakpoint
CREATE TYPE "public"."estado_compra" AS ENUM('PEDIDO', 'COMPRADO', 'PARCIAL', 'DEMORA', 'FALTANTE', 'ENTREGADA', 'CANCELADA');--> statement-breakpoint
CREATE TYPE "public"."estado_intervencion" AS ENUM('PROGRAMADA', 'EN_CURSO', 'REALIZADA', 'CANCELADA');--> statement-breakpoint
CREATE TYPE "public"."estado_molienda" AS ENUM('ENTREGADA', 'RECIBIDA', 'RECHAZADA');--> statement-breakpoint
CREATE TYPE "public"."tipo_intervencion" AS ENUM('CAMBIO_MATRIZ', 'REPARACION', 'SERVICE');--> statement-breakpoint
ALTER TYPE "public"."rol" ADD VALUE 'COMPRAS';--> statement-breakpoint
ALTER TYPE "public"."rol" ADD VALUE 'GERENCIA_CONSULTA';--> statement-breakpoint
CREATE TABLE "asignacion_operario" (
	"id" serial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"turno" "turno" NOT NULL,
	"usuario_id" integer NOT NULL,
	"inyectora" text,
	"creado_por_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asignacion_operario_uq" UNIQUE("fecha","turno","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "compra_entrega" (
	"id" serial PRIMARY KEY NOT NULL,
	"compra_id" integer NOT NULL,
	"kg" numeric(14, 3) NOT NULL,
	"lote_mp_id" integer,
	"observaciones" text,
	"usuario_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compra_mp" (
	"id" serial PRIMARY KEY NOT NULL,
	"materia_prima_id" integer NOT NULL,
	"proveedor" text,
	"cantidad_kg" numeric(14, 3) NOT NULL,
	"fecha_pedido" date NOT NULL,
	"fecha_entrega_estimada" date,
	"numero_oc" text,
	"estado" "estado_compra" DEFAULT 'PEDIDO' NOT NULL,
	"observaciones" text,
	"creado_por_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "descarte_molino" (
	"id" serial PRIMARY KEY NOT NULL,
	"origen" text NOT NULL,
	"ciclo_id" integer,
	"material" text NOT NULL,
	"kg" numeric(12, 3) NOT NULL,
	"observaciones" text,
	"molienda_entrega_id" integer,
	"recibido_por_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esquema_turno_dia" (
	"fecha" date PRIMARY KEY NOT NULL,
	"esquema" "esquema_turno" NOT NULL,
	"actualizado_por_id" integer,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intervencion_matriz" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" "tipo_intervencion" NOT NULL,
	"matriz" text NOT NULL,
	"matriz_anterior" text,
	"inyectora" text,
	"fecha_programada" date NOT NULL,
	"turno" "turno",
	"estado" "estado_intervencion" DEFAULT 'PROGRAMADA' NOT NULL,
	"responsable_id" integer,
	"tanda_id" integer,
	"descripcion" text,
	"observaciones" text,
	"iniciada_en" timestamp with time zone,
	"realizada_en" timestamp with time zone,
	"creado_por_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "molienda_entrega" (
	"id" serial PRIMARY KEY NOT NULL,
	"bolson" text NOT NULL,
	"materia_prima_id" integer NOT NULL,
	"kg" numeric(12, 3) NOT NULL,
	"observaciones" text,
	"estado" "estado_molienda" DEFAULT 'ENTREGADA' NOT NULL,
	"entregado_por_id" integer NOT NULL,
	"entregado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"recibido_por_id" integer,
	"recibido_en" timestamp with time zone,
	"movimiento_id" integer
);
--> statement-breakpoint
ALTER TABLE "dosificacion_master" ADD COLUMN "kg_referencia" numeric(10, 3) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "dosificacion_master" ADD COLUMN "materia_prima_base2_id" integer;--> statement-breakpoint
ALTER TABLE "dosificacion_master" ADD COLUMN "proporcion_base1" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "acepta_molienda" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "peso_confirmado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usuario" ADD COLUMN "roles_adicionales" "rol"[] DEFAULT '{}'::rol[] NOT NULL;--> statement-breakpoint
ALTER TABLE "asignacion_operario" ADD CONSTRAINT "asignacion_operario_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asignacion_operario" ADD CONSTRAINT "asignacion_operario_creado_por_id_usuario_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_entrega" ADD CONSTRAINT "compra_entrega_compra_id_compra_mp_id_fk" FOREIGN KEY ("compra_id") REFERENCES "public"."compra_mp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_entrega" ADD CONSTRAINT "compra_entrega_lote_mp_id_lote_mp_id_fk" FOREIGN KEY ("lote_mp_id") REFERENCES "public"."lote_mp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_entrega" ADD CONSTRAINT "compra_entrega_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_mp" ADD CONSTRAINT "compra_mp_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compra_mp" ADD CONSTRAINT "compra_mp_creado_por_id_usuario_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "descarte_molino" ADD CONSTRAINT "descarte_molino_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "descarte_molino" ADD CONSTRAINT "descarte_molino_molienda_entrega_id_molienda_entrega_id_fk" FOREIGN KEY ("molienda_entrega_id") REFERENCES "public"."molienda_entrega"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "descarte_molino" ADD CONSTRAINT "descarte_molino_recibido_por_id_usuario_id_fk" FOREIGN KEY ("recibido_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esquema_turno_dia" ADD CONSTRAINT "esquema_turno_dia_actualizado_por_id_usuario_id_fk" FOREIGN KEY ("actualizado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervencion_matriz" ADD CONSTRAINT "intervencion_matriz_responsable_id_usuario_id_fk" FOREIGN KEY ("responsable_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervencion_matriz" ADD CONSTRAINT "intervencion_matriz_tanda_id_tanda_id_fk" FOREIGN KEY ("tanda_id") REFERENCES "public"."tanda"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intervencion_matriz" ADD CONSTRAINT "intervencion_matriz_creado_por_id_usuario_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "molienda_entrega" ADD CONSTRAINT "molienda_entrega_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "molienda_entrega" ADD CONSTRAINT "molienda_entrega_entregado_por_id_usuario_id_fk" FOREIGN KEY ("entregado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "molienda_entrega" ADD CONSTRAINT "molienda_entrega_recibido_por_id_usuario_id_fk" FOREIGN KEY ("recibido_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "molienda_entrega" ADD CONSTRAINT "molienda_entrega_movimiento_id_movimiento_id_fk" FOREIGN KEY ("movimiento_id") REFERENCES "public"."movimiento"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asignacion_operario_fecha_idx" ON "asignacion_operario" USING btree ("fecha");--> statement-breakpoint
CREATE INDEX "compra_entrega_compra_idx" ON "compra_entrega" USING btree ("compra_id");--> statement-breakpoint
CREATE INDEX "compra_mp_estado_idx" ON "compra_mp" USING btree ("estado");--> statement-breakpoint
CREATE INDEX "compra_mp_mp_idx" ON "compra_mp" USING btree ("materia_prima_id");--> statement-breakpoint
CREATE INDEX "descarte_molino_pendiente_idx" ON "descarte_molino" USING btree ("molienda_entrega_id");--> statement-breakpoint
CREATE INDEX "intervencion_matriz_fecha_idx" ON "intervencion_matriz" USING btree ("fecha_programada");--> statement-breakpoint
ALTER TABLE "dosificacion_master" ADD CONSTRAINT "dosificacion_master_materia_prima_base2_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_base2_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Minuta 22/10 (OP-12): el sobrante como materia prima se habilita en todos
-- los productos. La molienda queda aparte (acepta_molienda, desactivada).
INSERT INTO "auditoria_config" ("entidad", "entidad_id", "campo", "valor_anterior", "valor_nuevo", "motivo", "usuario_id")
SELECT 'producto', p."id"::text, 'acepta_sobrante', 'false', 'true',
       'Minuta 22/10: sobrante como materia prima habilitado en todos los productos', u."id"
FROM "producto" p
CROSS JOIN (SELECT min("id") AS "id" FROM "usuario" WHERE "nombre" = 'Importación (sistema)') u
WHERE u."id" IS NOT NULL AND NOT p."acepta_sobrante";
--> statement-breakpoint
UPDATE "producto" SET "acepta_sobrante" = true WHERE NOT "acepta_sobrante";
--> statement-breakpoint
-- Dosificación de master: la unidad cargada era «g/kg» con valores 0,015 /
-- 0,012 / 0,018; el cliente confirmó (22/10) que son kg por kg = 15 g/kg.
-- Rejilla: 15 g por kg de 2240P (y el negro, 12 g/kg: misma corrección de
-- unidad, coincide con la planilla de tolva de 1,2 kg cada 100 kg).
-- Ciego: 15 g por cada 0,5 kg de mezcla 2630PC + Plastomer (= 30 g/kg); la
-- proporción entre ambos queda pendiente (null).
INSERT INTO "auditoria_config" ("entidad", "entidad_id", "campo", "valor_anterior", "valor_nuevo", "motivo", "usuario_id")
SELECT 'dosificacion_master', d."id"::text, 'g_por_kg_mp', d."g_por_kg_mp"::text,
       CASE WHEN d."familia" = 'CIEGO' AND d."color_id" IS NULL THEN '30' ELSE (d."g_por_kg_mp" * 1000)::text END,
       CASE WHEN d."familia" = 'CIEGO' AND d."color_id" IS NULL
            THEN 'Minuta 22/10: 15 g de master cada 0,5 kg de mezcla 2630PC + Plastomer (= 30 g/kg)'
            ELSE 'Minuta 22/10: el valor era kg por kg (0,015 kg = 15 g), no g/kg' END,
       u."id"
FROM "dosificacion_master" d
CROSS JOIN (SELECT min("id") AS "id" FROM "usuario" WHERE "nombre" = 'Importación (sistema)') u
WHERE u."id" IS NOT NULL AND d."g_por_kg_mp" < 1;
--> statement-breakpoint
UPDATE "dosificacion_master" SET "g_por_kg_mp" = "g_por_kg_mp" * 1000, "actualizado_en" = now()
WHERE "g_por_kg_mp" < 1 AND NOT ("familia" = 'CIEGO' AND "color_id" IS NULL);
--> statement-breakpoint
UPDATE "dosificacion_master" d SET
  "g_por_kg_mp" = 30,
  "kg_referencia" = 0.5,
  "materia_prima_base_id" = COALESCE((SELECT "id" FROM "materia_prima" WHERE "codigo_interno" = '3'), d."materia_prima_base_id"),
  "materia_prima_base2_id" = (SELECT "id" FROM "materia_prima" WHERE "codigo_interno" = '19'),
  "proporcion_base1" = NULL,
  "observaciones" = '15 g de master cada 0,5 kg de mezcla 2630PC + Plastomer (minuta 22/10). Proporción entre ambos: pendiente.',
  "actualizado_en" = now()
WHERE d."familia" = 'CIEGO' AND d."color_id" IS NULL AND d."g_por_kg_mp" < 1;
--> statement-breakpoint
UPDATE "dosificacion_master" SET "observaciones" = '15 g de master por kg de 2240P (minuta 22/10)'
WHERE "familia" = 'REJILLA' AND "color_id" IS NULL;
