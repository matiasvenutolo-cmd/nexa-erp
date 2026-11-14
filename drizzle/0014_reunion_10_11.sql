ALTER TYPE "public"."estado_compra" ADD VALUE 'SOLICITADA' BEFORE 'PEDIDO';--> statement-breakpoint
ALTER TYPE "public"."tipo_aviso" ADD VALUE 'PEDIDO_MODIFICADO';--> statement-breakpoint
ALTER TYPE "public"."tipo_aviso" ADD VALUE 'PEDIDO_MATERIA_PRIMA';--> statement-breakpoint
ALTER TABLE "caja" ADD COLUMN "turno_id" integer;--> statement-breakpoint
ALTER TABLE "intervencion_matriz" ADD COLUMN "duracion_horas" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "piezas_por_hora" integer;--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "setup_horas" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "turno_produccion" ADD COLUMN "revisado_por_id" integer;--> statement-breakpoint
ALTER TABLE "turno_produccion" ADD COLUMN "revisado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "caja" ADD CONSTRAINT "caja_turno_id_turno_produccion_id_fk" FOREIGN KEY ("turno_id") REFERENCES "public"."turno_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turno_produccion" ADD CONSTRAINT "turno_produccion_revisado_por_id_usuario_id_fk" FOREIGN KEY ("revisado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;