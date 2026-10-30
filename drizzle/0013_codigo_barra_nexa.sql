-- Código de barras NEXA (regla del cliente 30/10/2026): la partida se numera
-- dentro del año y la caja guarda el código impreso en la etiqueta.
-- Sólo agrega; el número de partida pasa a ser único por año.
ALTER TABLE "caja" ADD COLUMN "codigo_etiqueta" text;--> statement-breakpoint
ALTER TABLE "partida" ADD COLUMN "anio" integer;--> statement-breakpoint
UPDATE "partida" SET "anio" = EXTRACT(YEAR FROM "fecha_apertura")::integer;--> statement-breakpoint
ALTER TABLE "partida" ALTER COLUMN "anio" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "partida_anio_numero_uq" ON "partida" USING btree ("anio","numero");--> statement-breakpoint
ALTER TABLE "partida" DROP CONSTRAINT "partida_numero_unique";--> statement-breakpoint
CREATE INDEX "caja_etiqueta_idx" ON "caja" USING btree ("codigo_etiqueta");
