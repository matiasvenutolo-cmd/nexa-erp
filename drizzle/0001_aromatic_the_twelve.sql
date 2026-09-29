CREATE TABLE "ciclo_pedido" (
	"id" serial PRIMARY KEY NOT NULL,
	"ciclo_id" integer NOT NULL,
	"pedido_id" integer NOT NULL,
	"cantidad_asignada" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ciclo_pedido" ADD CONSTRAINT "ciclo_pedido_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclo_pedido" ADD CONSTRAINT "ciclo_pedido_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ciclo_pedido_ciclo_idx" ON "ciclo_pedido" USING btree ("ciclo_id");--> statement-breakpoint
CREATE INDEX "ciclo_pedido_pedido_idx" ON "ciclo_pedido" USING btree ("pedido_id");--> statement-breakpoint
ALTER TABLE "ciclo_produccion" DROP COLUMN "pedido_id";