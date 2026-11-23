ALTER TYPE "public"."tipo_aviso" ADD VALUE 'MATERIAL_PIE';--> statement-breakpoint
ALTER TABLE "novedad_maquina" ADD COLUMN "pedido" jsonb;--> statement-breakpoint
ALTER TABLE "novedad_maquina" ADD COLUMN "avisado_mp_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "novedad_maquina" ADD COLUMN "avisado_mp_por_id" integer;--> statement-breakpoint
ALTER TABLE "novedad_maquina" ADD COLUMN "descartado_en" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "novedad_maquina" ADD COLUMN "descartado_por_id" integer;--> statement-breakpoint
ALTER TABLE "novedad_maquina" ADD CONSTRAINT "novedad_maquina_avisado_mp_por_id_usuario_id_fk" FOREIGN KEY ("avisado_mp_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "novedad_maquina" ADD CONSTRAINT "novedad_maquina_descartado_por_id_usuario_id_fk" FOREIGN KEY ("descartado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;