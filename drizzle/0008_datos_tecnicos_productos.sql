-- Datos técnicos por pieza según la planilla del cliente "Calculo por metro"
-- (hojas "unidades" y "peso"): 0,16 m² por baldosa; piso 0,610 kg; rampa
-- 0,1175 kg (235 g por golpe de 2); ángulo/esquinero 0,02 kg (80 g por golpe
-- de 4). El importador había guardado en m2_por_unidad los m² de STOCK del
-- Excel (p. ej. 174 u × 0,16 = 27,84), no la superficie por pieza.
-- Cada cambio queda en la auditoría con el valor anterior. Los accesorios no
-- llevan superficie.
INSERT INTO "auditoria_config" ("entidad", "entidad_id", "campo", "valor_anterior", "valor_nuevo", "motivo", "usuario_id")
SELECT 'producto', p."id"::text, 'm2_por_unidad', p."m2_por_unidad"::text,
       CASE WHEN p."es_accesorio" THEN NULL ELSE '0.1600' END,
       'Superficie por pieza según "Calculo por metro" (0,16 m² por baldosa); el valor anterior eran m² de stock importados del Excel',
       u."id"
FROM "producto" p
CROSS JOIN (SELECT min("id") AS "id" FROM "usuario" WHERE "nombre" = 'Importación (sistema)') u
WHERE u."id" IS NOT NULL
  AND ((NOT p."es_accesorio" AND p."m2_por_unidad" IS DISTINCT FROM 0.16) OR (p."es_accesorio" AND p."m2_por_unidad" IS NOT NULL));
--> statement-breakpoint
INSERT INTO "auditoria_config" ("entidad", "entidad_id", "campo", "valor_anterior", "valor_nuevo", "motivo", "usuario_id")
SELECT 'producto', p."id"::text, 'kg_por_unidad', p."kg_por_unidad"::text,
       CASE p."tipo" WHEN 'RAMPA' THEN '0.1175' ELSE '0.0200' END,
       'Peso por pieza según "Calculo por metro" (rampa 235 g por golpe de 2; ángulo/esquinero 80 g por golpe de 4)',
       u."id"
FROM "producto" p
CROSS JOIN (SELECT min("id") AS "id" FROM "usuario" WHERE "nombre" = 'Importación (sistema)') u
WHERE u."id" IS NOT NULL AND p."kg_por_unidad" IS NULL AND p."tipo" IN ('RAMPA', 'ESQUINERO');
--> statement-breakpoint
UPDATE "producto" SET "m2_por_unidad" = CASE WHEN "es_accesorio" THEN NULL ELSE 0.16 END
WHERE (NOT "es_accesorio" AND "m2_por_unidad" IS DISTINCT FROM 0.16) OR ("es_accesorio" AND "m2_por_unidad" IS NOT NULL);
--> statement-breakpoint
UPDATE "producto" SET "kg_por_unidad" = CASE "tipo" WHEN 'RAMPA' THEN 0.1175 ELSE 0.02 END
WHERE "kg_por_unidad" IS NULL AND "tipo" IN ('RAMPA', 'ESQUINERO');
