CREATE TYPE "public"."estado_tanda" AS ENUM('PLANIFICADA', 'EN_CURSO', 'COMPLETADA', 'POSTERGADA', 'CANCELADA');--> statement-breakpoint
CREATE TYPE "public"."estado_turno" AS ENUM('ABIERTO', 'CERRADO');--> statement-breakpoint
CREATE TYPE "public"."tipo_novedad" AS ENUM('NO_CARGA', 'CARGA_DISTINTA', 'DIFERENCIA_RELEVO', 'INTERRUPCION');--> statement-breakpoint
CREATE TYPE "public"."tipo_receta" AS ENUM('REGIMEN', 'ARRANQUE');--> statement-breakpoint
CREATE TYPE "public"."turno" AS ENUM('MANANA', 'TARDE', 'NOCHE');--> statement-breakpoint
ALTER TYPE "public"."origen_movimiento" ADD VALUE 'CARGA_TOLVA';--> statement-breakpoint
ALTER TYPE "public"."origen_movimiento" ADD VALUE 'CONSUMO';--> statement-breakpoint
ALTER TYPE "public"."origen_movimiento" ADD VALUE 'DIFERENCIA_BALANZA';--> statement-breakpoint
ALTER TYPE "public"."origen_movimiento" ADD VALUE 'MOLIENDA';--> statement-breakpoint
ALTER TYPE "public"."tipo_aviso" ADD VALUE 'ERROR_INFORMADO';--> statement-breakpoint
CREATE TABLE "fraccionamiento_mp" (
	"id" serial PRIMARY KEY NOT NULL,
	"materia_prima_id" integer NOT NULL,
	"lote_mp_id" integer,
	"presentacion_id" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"kg_total" numeric(12, 3) NOT NULL,
	"observaciones" text,
	"usuario_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "novedad_maquina" (
	"id" serial PRIMARY KEY NOT NULL,
	"ciclo_id" integer,
	"turno_id" integer,
	"inyectora" text NOT NULL,
	"tipo" "tipo_novedad" NOT NULL,
	"motivo" text NOT NULL,
	"detalle" text,
	"usuario_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presentacion_mp" (
	"id" serial PRIMARY KEY NOT NULL,
	"materia_prima_id" integer,
	"tipo_mp" "tipo_mp",
	"nombre" text NOT NULL,
	"kg" numeric(10, 3) NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receta_carga" (
	"id" serial PRIMARY KEY NOT NULL,
	"producto_id" integer NOT NULL,
	"tipo" "tipo_receta" DEFAULT 'REGIMEN' NOT NULL,
	"observaciones" text,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_por_id" integer,
	CONSTRAINT "receta_carga_uq" UNIQUE("producto_id","tipo")
);
--> statement-breakpoint
CREATE TABLE "receta_carga_item" (
	"id" serial PRIMARY KEY NOT NULL,
	"receta_id" integer NOT NULL,
	"materia_prima_id" integer NOT NULL,
	"presentacion_id" integer NOT NULL,
	"cantidad" numeric(8, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tanda" (
	"id" serial PRIMARY KEY NOT NULL,
	"producto_id" integer NOT NULL,
	"cantidad_pedidos" integer DEFAULT 0 NOT NULL,
	"cantidad_stock" integer DEFAULT 0 NOT NULL,
	"orden" integer NOT NULL,
	"inyectora" text,
	"fecha" date,
	"turno" "turno",
	"estado" "estado_tanda" DEFAULT 'PLANIFICADA' NOT NULL,
	"usar_arranque" boolean DEFAULT false NOT NULL,
	"observaciones" text,
	"postergada_motivo" text,
	"ciclo_id" integer,
	"creado_por_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tanda_pedido" (
	"id" serial PRIMARY KEY NOT NULL,
	"tanda_id" integer NOT NULL,
	"pedido_id" integer NOT NULL,
	"pedido_linea_id" integer NOT NULL,
	"cantidad" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turno_produccion" (
	"id" serial PRIMARY KEY NOT NULL,
	"ciclo_id" integer NOT NULL,
	"inyectora" text NOT NULL,
	"turno" "turno" NOT NULL,
	"operario_id" integer NOT NULL,
	"operario_nombre" text,
	"inicio" timestamp with time zone DEFAULT now() NOT NULL,
	"golpes_inicio" integer,
	"fin" timestamp with time zone,
	"golpes_fin" integer,
	"piezas" integer,
	"descarte_kg" numeric(10, 3),
	"motivo_interrupcion" text,
	"observaciones" text,
	"recepcion_ok" boolean,
	"recepcion_motivo" text,
	"recepcion_detalle" text,
	"estado" "estado_turno" DEFAULT 'ABIERTO' NOT NULL,
	"token" text,
	"cerrado_por_id" integer,
	CONSTRAINT "turno_produccion_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "ciclo_produccion" ADD COLUMN "tanda_id" integer;--> statement-breakpoint
ALTER TABLE "ciclo_produccion" ADD COLUMN "descarte_kg" numeric(10, 3);--> statement-breakpoint
ALTER TABLE "movimiento_maquina" ADD COLUMN "turno_id" integer;--> statement-breakpoint
ALTER TABLE "movimiento_maquina" ADD COLUMN "planificado_kg" numeric(14, 3);--> statement-breakpoint
ALTER TABLE "movimiento_maquina" ADD COLUMN "motivo_excepcion" text;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "archivado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "archivado_motivo" text;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "archivado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "archivado_por_id" integer;--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "colada_kg_por_golpe" numeric(8, 4);--> statement-breakpoint
ALTER TABLE "fraccionamiento_mp" ADD CONSTRAINT "fraccionamiento_mp_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraccionamiento_mp" ADD CONSTRAINT "fraccionamiento_mp_lote_mp_id_lote_mp_id_fk" FOREIGN KEY ("lote_mp_id") REFERENCES "public"."lote_mp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraccionamiento_mp" ADD CONSTRAINT "fraccionamiento_mp_presentacion_id_presentacion_mp_id_fk" FOREIGN KEY ("presentacion_id") REFERENCES "public"."presentacion_mp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fraccionamiento_mp" ADD CONSTRAINT "fraccionamiento_mp_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novedad_maquina" ADD CONSTRAINT "novedad_maquina_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novedad_maquina" ADD CONSTRAINT "novedad_maquina_turno_id_turno_produccion_id_fk" FOREIGN KEY ("turno_id") REFERENCES "public"."turno_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novedad_maquina" ADD CONSTRAINT "novedad_maquina_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "presentacion_mp" ADD CONSTRAINT "presentacion_mp_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta_carga" ADD CONSTRAINT "receta_carga_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta_carga" ADD CONSTRAINT "receta_carga_actualizado_por_id_usuario_id_fk" FOREIGN KEY ("actualizado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta_carga_item" ADD CONSTRAINT "receta_carga_item_receta_id_receta_carga_id_fk" FOREIGN KEY ("receta_id") REFERENCES "public"."receta_carga"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta_carga_item" ADD CONSTRAINT "receta_carga_item_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta_carga_item" ADD CONSTRAINT "receta_carga_item_presentacion_id_presentacion_mp_id_fk" FOREIGN KEY ("presentacion_id") REFERENCES "public"."presentacion_mp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanda" ADD CONSTRAINT "tanda_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanda" ADD CONSTRAINT "tanda_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanda" ADD CONSTRAINT "tanda_creado_por_id_usuario_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanda_pedido" ADD CONSTRAINT "tanda_pedido_tanda_id_tanda_id_fk" FOREIGN KEY ("tanda_id") REFERENCES "public"."tanda"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanda_pedido" ADD CONSTRAINT "tanda_pedido_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tanda_pedido" ADD CONSTRAINT "tanda_pedido_pedido_linea_id_pedido_linea_id_fk" FOREIGN KEY ("pedido_linea_id") REFERENCES "public"."pedido_linea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turno_produccion" ADD CONSTRAINT "turno_produccion_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turno_produccion" ADD CONSTRAINT "turno_produccion_operario_id_usuario_id_fk" FOREIGN KEY ("operario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turno_produccion" ADD CONSTRAINT "turno_produccion_cerrado_por_id_usuario_id_fk" FOREIGN KEY ("cerrado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "novedad_ciclo_idx" ON "novedad_maquina" USING btree ("ciclo_id");--> statement-breakpoint
CREATE INDEX "receta_item_receta_idx" ON "receta_carga_item" USING btree ("receta_id");--> statement-breakpoint
CREATE INDEX "tanda_estado_idx" ON "tanda" USING btree ("estado","orden");--> statement-breakpoint
CREATE INDEX "tanda_pedido_tanda_idx" ON "tanda_pedido" USING btree ("tanda_id");--> statement-breakpoint
CREATE INDEX "tanda_pedido_linea_idx" ON "tanda_pedido" USING btree ("pedido_linea_id");--> statement-breakpoint
CREATE INDEX "turno_ciclo_idx" ON "turno_produccion" USING btree ("ciclo_id","estado");--> statement-breakpoint
CREATE INDEX "turno_inyectora_idx" ON "turno_produccion" USING btree ("inyectora","estado");--> statement-breakpoint
-- Ubicaciones del stock de materia prima (minuta 15/10): el depósito "NEXA"
-- sigue siendo el de Materia prima; se suman pie de máquina y tolva/en proceso.
-- Empiezan vacías: los retiros anteriores ya se descontaron del depósito.
INSERT INTO "deposito" ("nombre", "activo") VALUES ('Pie de máquina', true) ON CONFLICT ("nombre") DO NOTHING;
--> statement-breakpoint
INSERT INTO "deposito" ("nombre", "activo") VALUES ('Tolva / en proceso', true) ON CONFLICT ("nombre") DO NOTHING;
--> statement-breakpoint
-- Presentaciones de referencia de la planilla "Carga de materia prima en
-- tolva": bolsa de 25 kg de copolímero, bolsitas de master de 600 g (régimen)
-- y 750 g (arranque). Editables desde Configuración → Recetas de carga.
INSERT INTO "presentacion_mp" ("tipo_mp", "nombre", "kg") VALUES
  ('VIRGEN', 'Bolsa 25 kg', 25),
  ('MASTER', 'Bolsita 600 g', 0.6),
  ('MASTER', 'Bolsita 750 g', 0.75);
