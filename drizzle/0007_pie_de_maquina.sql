CREATE TYPE "public"."estado_retiro" AS ENUM('ABIERTO', 'CERRADO');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento_maquina" AS ENUM('CARGA_TOLVA', 'DEVOLUCION', 'SOBRANTE', 'DIFERENCIA');--> statement-breakpoint
CREATE TABLE "movimiento_maquina" (
	"id" serial PRIMARY KEY NOT NULL,
	"retiro_maquina_id" integer NOT NULL,
	"retiro_mp_id" integer,
	"tipo" "tipo_movimiento_maquina" NOT NULL,
	"cantidad" numeric(14, 3) NOT NULL,
	"ciclo_id" integer,
	"materia_prima_destino_id" integer,
	"movimiento_id" integer,
	"observaciones" text,
	"usuario_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"token" text,
	"anulado" boolean DEFAULT false NOT NULL,
	"anulado_por_id" integer,
	"anulado_en" timestamp with time zone,
	"anulado_motivo" text,
	CONSTRAINT "movimiento_maquina_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "retiro_maquina" (
	"id" serial PRIMARY KEY NOT NULL,
	"inyectora" text NOT NULL,
	"ciclo_id" integer,
	"fecha_hora" timestamp with time zone DEFAULT now() NOT NULL,
	"operario_id" integer,
	"entrega_id" integer,
	"producto_previsto_id" integer,
	"piezas_previstas" integer,
	"observaciones" text,
	"estado" "estado_retiro" DEFAULT 'ABIERTO' NOT NULL,
	"cerrado_por_id" integer,
	"cerrado_en" timestamp with time zone,
	"token" text,
	"creado_por_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retiro_maquina_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "ciclo_materia_prima" ADD COLUMN "movimiento_maquina_id" integer;--> statement-breakpoint
ALTER TABLE "ciclo_produccion" ADD COLUMN "cantidad_deseada" integer;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD COLUMN "retiro_maquina_id" integer;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD COLUMN "codigo_leido" text;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD COLUMN "anulado" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD COLUMN "anulado_por_id" integer;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD COLUMN "anulado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD COLUMN "anulado_motivo" text;--> statement-breakpoint
ALTER TABLE "movimiento_maquina" ADD CONSTRAINT "movimiento_maquina_retiro_maquina_id_retiro_maquina_id_fk" FOREIGN KEY ("retiro_maquina_id") REFERENCES "public"."retiro_maquina"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_maquina" ADD CONSTRAINT "movimiento_maquina_retiro_mp_id_retiro_mp_id_fk" FOREIGN KEY ("retiro_mp_id") REFERENCES "public"."retiro_mp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_maquina" ADD CONSTRAINT "movimiento_maquina_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_maquina" ADD CONSTRAINT "movimiento_maquina_materia_prima_destino_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_destino_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_maquina" ADD CONSTRAINT "movimiento_maquina_movimiento_id_movimiento_id_fk" FOREIGN KEY ("movimiento_id") REFERENCES "public"."movimiento"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_maquina" ADD CONSTRAINT "movimiento_maquina_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento_maquina" ADD CONSTRAINT "movimiento_maquina_anulado_por_id_usuario_id_fk" FOREIGN KEY ("anulado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_maquina" ADD CONSTRAINT "retiro_maquina_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_maquina" ADD CONSTRAINT "retiro_maquina_operario_id_usuario_id_fk" FOREIGN KEY ("operario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_maquina" ADD CONSTRAINT "retiro_maquina_entrega_id_usuario_id_fk" FOREIGN KEY ("entrega_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_maquina" ADD CONSTRAINT "retiro_maquina_producto_previsto_id_producto_id_fk" FOREIGN KEY ("producto_previsto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_maquina" ADD CONSTRAINT "retiro_maquina_cerrado_por_id_usuario_id_fk" FOREIGN KEY ("cerrado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_maquina" ADD CONSTRAINT "retiro_maquina_creado_por_id_usuario_id_fk" FOREIGN KEY ("creado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mov_maquina_retiro_idx" ON "movimiento_maquina" USING btree ("retiro_maquina_id");--> statement-breakpoint
CREATE INDEX "mov_maquina_ciclo_idx" ON "movimiento_maquina" USING btree ("ciclo_id");--> statement-breakpoint
CREATE INDEX "retiro_maquina_estado_idx" ON "retiro_maquina" USING btree ("estado","inyectora");--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD CONSTRAINT "retiro_mp_retiro_maquina_id_retiro_maquina_id_fk" FOREIGN KEY ("retiro_maquina_id") REFERENCES "public"."retiro_maquina"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD CONSTRAINT "retiro_mp_anulado_por_id_usuario_id_fk" FOREIGN KEY ("anulado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;