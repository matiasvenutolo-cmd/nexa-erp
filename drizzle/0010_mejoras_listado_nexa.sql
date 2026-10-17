CREATE TYPE "public"."tipo_evento_produccion" AS ENUM('INICIO', 'PAUSA', 'REANUDACION', 'CANCELACION', 'FINALIZACION');--> statement-breakpoint
CREATE SEQUENCE "public"."pedido_numero_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "evento_produccion" (
	"id" serial PRIMARY KEY NOT NULL,
	"ciclo_id" integer NOT NULL,
	"tipo" "tipo_evento_produccion" NOT NULL,
	"motivo" text,
	"usuario_id" integer NOT NULL,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ciclo_produccion" ADD COLUMN "pausada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ciclo_produccion" ADD COLUMN "cancelada" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "color" ADD COLUMN "hex" text;--> statement-breakpoint
ALTER TABLE "pedido" ADD COLUMN "token" text;--> statement-breakpoint
ALTER TABLE "producto" ADD COLUMN "acepta_sobrante" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "turno_produccion" ADD COLUMN "material_al_cierre" text;--> statement-breakpoint
ALTER TABLE "evento_produccion" ADD CONSTRAINT "evento_produccion_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evento_produccion" ADD CONSTRAINT "evento_produccion_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evento_produccion_ciclo_idx" ON "evento_produccion" USING btree ("ciclo_id");--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_token_unique" UNIQUE("token");--> statement-breakpoint
-- La numeración sigue la serie que ya usa el cliente (último N° numérico + 1).
SELECT setval('pedido_numero_seq', COALESCE((SELECT max(numero_orden::bigint) FROM pedido WHERE numero_orden ~ '^[0-9]+$'), 0) + 1, false);
--> statement-breakpoint
-- Muestras de la paleta del cliente (imagen del documento "Listado mejoras NEXA").
UPDATE color SET hex = v.hex FROM (VALUES
  ('yute', '#c9b89a'), ('azul claro', '#5b9bd5'), ('celeste', '#7ec8e3'), ('verde claro', '#85e13f'),
  ('verde oscuro', '#2d5a3d'), ('azul oscuro', '#1e3a7a'), ('naranja', '#e85d2b'), ('amarillo', '#ffd100'),
  ('rojo', '#d32f2f'), ('gris claro', '#cccfce'), ('blanco', '#faf7f1'), ('negro', '#111111'), ('gris oscuro', '#585d69')
) AS v(clave, hex) WHERE color.clave = v.clave AND color.hex IS NULL;
--> statement-breakpoint
-- Horarios de inicio de cada turno (hora 0-23). -1 = sin configurar: hasta que
-- se definan, el operario elige el turno a mano.
INSERT INTO "parametro" ("clave", "valor", "descripcion", "unidad") VALUES
  ('turno_manana_inicio', -1, 'Hora de inicio del turno mañana (-1 = sin configurar)', 'hora'),
  ('turno_tarde_inicio', -1, 'Hora de inicio del turno tarde (-1 = sin configurar)', 'hora'),
  ('turno_noche_inicio', -1, 'Hora de inicio del turno noche (-1 = sin configurar)', 'hora')
ON CONFLICT ("clave") DO NOTHING;
