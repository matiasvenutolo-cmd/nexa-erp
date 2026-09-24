CREATE TYPE "public"."condicion_iva" AS ENUM('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL');--> statement-breakpoint
CREATE TYPE "public"."estado_caja" AS ENUM('EN_STOCK', 'ARMADA', 'DESPACHADA', 'BAJA');--> statement-breakpoint
CREATE TYPE "public"."estado_inventario" AS ENUM('ABIERTO', 'CERRADO');--> statement-breakpoint
CREATE TYPE "public"."estado_pedido" AS ENUM('PEDIDO', 'EN_ARMADO', 'LISTO_PARA_DESPACHAR', 'PARCIALMENTE_DESPACHADO', 'ENTREGADO', 'CANCELADO');--> statement-breakpoint
CREATE TYPE "public"."estado_reserva" AS ENUM('ABIERTA', 'CONSUMIDA', 'LIBERADA');--> statement-breakpoint
CREATE TYPE "public"."familia" AS ENUM('REJILLA', 'CIEGO');--> statement-breakpoint
CREATE TYPE "public"."motivo_devolucion" AS ENUM('DIRECCION_ERRONEA', 'MERCADERIA_ERRONEA', 'MERCADERIA_FALLADA', 'MATERIAL_DEFECTUOSO');--> statement-breakpoint
CREATE TYPE "public"."origen_movimiento" AS ENUM('IMPORTACION', 'CICLO', 'PEDIDO', 'INVENTARIO', 'TRANSFORMACION', 'INGRESO_MP', 'RETIRO_MP', 'DEVOLUCION', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."rol" AS ENUM('GERENCIA', 'SUPERVISOR', 'ADMINISTRACION', 'ENCARGADO', 'MATERIA_PRIMA', 'RETIROS_MP', 'MATRICES', 'MOLINO', 'DESPACHO', 'OPERARIO');--> statement-breakpoint
CREATE TYPE "public"."tipo_movimiento" AS ENUM('ENTRADA', 'SALIDA', 'AJUSTE', 'TRANSFERENCIA', 'TRANSFORMACION');--> statement-breakpoint
CREATE TYPE "public"."tipo_mp" AS ENUM('VIRGEN', 'MASTER', 'MOLIENDA', 'SOBRANTE', 'MUESTRA');--> statement-breakpoint
CREATE TYPE "public"."tipo_piqueo" AS ENUM('ARMADO', 'CONTROL_FINAL');--> statement-breakpoint
CREATE TYPE "public"."tipo_producto" AS ENUM('UNICO', 'TRAMA', 'MONEDA', 'BORDE', 'ESQUINERO', 'RAMPA');--> statement-breakpoint
CREATE TABLE "caja" (
	"id" serial PRIMARY KEY NOT NULL,
	"partida_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"ciclo_id" integer,
	"numero_caja" integer NOT NULL,
	"cantidad" integer NOT NULL,
	"codigo_barra" text NOT NULL,
	"estado" "estado_caja" DEFAULT 'EN_STOCK' NOT NULL,
	"fecha" date NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "caja_codigo_barra_unique" UNIQUE("codigo_barra")
);
--> statement-breakpoint
CREATE TABLE "certificado_calidad" (
	"id" serial PRIMARY KEY NOT NULL,
	"numero_correlativo" integer NOT NULL,
	"proveedor" text NOT NULL,
	"materia_prima_id" integer NOT NULL,
	"fecha_recepcion" date NOT NULL,
	"archivo_url" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" integer NOT NULL,
	CONSTRAINT "certificado_calidad_numero_correlativo_unique" UNIQUE("numero_correlativo")
);
--> statement-breakpoint
CREATE TABLE "ciclo_materia_prima" (
	"id" serial PRIMARY KEY NOT NULL,
	"ciclo_id" integer NOT NULL,
	"lote_mp_id" integer,
	"materia_prima_id" integer NOT NULL,
	"cantidad_kg" numeric(12, 3) NOT NULL,
	"es_master" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ciclo_produccion" (
	"id" serial PRIMARY KEY NOT NULL,
	"partida_id" integer,
	"producto_id" integer,
	"pedido_id" integer,
	"inyectora" text NOT NULL,
	"fecha_inicio" timestamp with time zone NOT NULL,
	"golpes_inicio" integer,
	"piezas_por_golpe" integer,
	"ciclo_segundos" numeric(8, 2),
	"modo" text,
	"operario_id" integer,
	"fecha_fin" timestamp with time zone,
	"golpes_fin" integer,
	"piezas_producidas" integer,
	"piezas_descartadas" integer,
	"piezas_entregadas" integer,
	"colada_kg" numeric(10, 3),
	"rebarba_kg" numeric(10, 3),
	"scrap_kg" numeric(10, 3),
	"cambio_ciclo_causa" text,
	"observaciones" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" integer
);
--> statement-breakpoint
CREATE TABLE "cliente" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"cuit" text,
	"condicion_iva" "condicion_iva",
	"email" text,
	"telefono" text,
	"domicilio" text,
	"localidad" text,
	"observaciones" text,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "color" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"iniciales" text NOT NULL,
	"oficial" boolean DEFAULT false NOT NULL,
	CONSTRAINT "color_nombre_unique" UNIQUE("nombre"),
	CONSTRAINT "color_iniciales_unique" UNIQUE("iniciales")
);
--> statement-breakpoint
CREATE TABLE "deposito" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	CONSTRAINT "deposito_nombre_unique" UNIQUE("nombre")
);
--> statement-breakpoint
CREATE TABLE "despacho" (
	"id" serial PRIMARY KEY NOT NULL,
	"pedido_id" integer NOT NULL,
	"numero_remito" text,
	"fecha" date NOT NULL,
	"modo_entrega" text,
	"transporte" text,
	"remito_firmado_url" text,
	"controlado_por_id" integer,
	"observaciones" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "despacho_linea" (
	"id" serial PRIMARY KEY NOT NULL,
	"despacho_id" integer NOT NULL,
	"pedido_linea_id" integer NOT NULL,
	"unidades" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devolucion" (
	"id" serial PRIMARY KEY NOT NULL,
	"pedido_id" integer NOT NULL,
	"despacho_id" integer,
	"motivo" "motivo_devolucion" NOT NULL,
	"descripcion" text NOT NULL,
	"partida_afectada_id" integer,
	"resolucion" text,
	"resuelto_en" timestamp with time zone,
	"supervisor_id" integer,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventario_fisico" (
	"id" serial PRIMARY KEY NOT NULL,
	"deposito_id" integer NOT NULL,
	"fecha" date NOT NULL,
	"estado" "estado_inventario" DEFAULT 'ABIERTO' NOT NULL,
	"responsable_id" integer NOT NULL,
	"observaciones" text,
	"cerrado_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inventario_linea" (
	"id" serial PRIMARY KEY NOT NULL,
	"inventario_id" integer NOT NULL,
	"producto_id" integer,
	"materia_prima_id" integer,
	"cantidad_sistema" numeric(14, 3) NOT NULL,
	"cantidad_contada" numeric(14, 3) NOT NULL,
	"motivo" text
);
--> statement-breakpoint
CREATE TABLE "lote_mp" (
	"id" serial PRIMARY KEY NOT NULL,
	"materia_prima_id" integer NOT NULL,
	"certificado_id" integer,
	"numero_lote" text NOT NULL,
	"codigo_barra" text NOT NULL,
	"fecha_ingreso" date NOT NULL,
	"cantidad_ingresada" numeric(14, 3) NOT NULL,
	"ubicacion" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lote_mp_codigo_barra_unique" UNIQUE("codigo_barra")
);
--> statement-breakpoint
CREATE TABLE "materia_prima" (
	"id" serial PRIMARY KEY NOT NULL,
	"codigo_interno" text NOT NULL,
	"nombre" text NOT NULL,
	"tipo" "tipo_mp" NOT NULL,
	"unidad" text DEFAULT 'kg' NOT NULL,
	"proveedor" text,
	"minimo" numeric(12, 3),
	"maximo" numeric(12, 3),
	"activo" boolean DEFAULT true NOT NULL,
	"observaciones" text,
	CONSTRAINT "materia_prima_codigo_interno_unique" UNIQUE("codigo_interno")
);
--> statement-breakpoint
CREATE TABLE "movimiento" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" "tipo_movimiento" NOT NULL,
	"deposito_id" integer NOT NULL,
	"producto_id" integer,
	"materia_prima_id" integer,
	"lote_mp_id" integer,
	"partida_id" integer,
	"caja_id" integer,
	"cantidad" numeric(14, 3) NOT NULL,
	"origen" "origen_movimiento" NOT NULL,
	"origen_id" integer,
	"contrapartida_id" integer,
	"motivo" text,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partida" (
	"id" serial PRIMARY KEY NOT NULL,
	"numero" integer NOT NULL,
	"producto_id" integer,
	"descripcion_producto" text,
	"fecha_apertura" date NOT NULL,
	"fecha_cierre" date,
	"observaciones" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partida_numero_unique" UNIQUE("numero")
);
--> statement-breakpoint
CREATE TABLE "pedido" (
	"id" serial PRIMARY KEY NOT NULL,
	"numero_orden" text,
	"cliente_id" integer NOT NULL,
	"fecha_pedido" date NOT NULL,
	"fecha_entrega_pactada" date,
	"estado" "estado_pedido" DEFAULT 'PEDIDO' NOT NULL,
	"prioridad" integer DEFAULT 0 NOT NULL,
	"contacto" text,
	"domicilio_entrega" text,
	"modo_entrega" text,
	"transporte" text,
	"requiere_colocacion" boolean DEFAULT false NOT NULL,
	"metodo_pago" text,
	"total" numeric(14, 2),
	"senia" numeric(14, 2),
	"numero_comprobante" text,
	"observaciones" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"usuario_id" integer,
	CONSTRAINT "pedido_numero_orden_unique" UNIQUE("numero_orden")
);
--> statement-breakpoint
CREATE TABLE "pedido_linea" (
	"id" serial PRIMARY KEY NOT NULL,
	"pedido_id" integer NOT NULL,
	"producto_id" integer,
	"descripcion" text,
	"color_texto" text,
	"unidades_pedidas" integer NOT NULL,
	"unidades_armadas" integer DEFAULT 0 NOT NULL,
	"unidades_despachadas" integer DEFAULT 0 NOT NULL,
	"precio_unitario" numeric(14, 2),
	"observaciones" text
);
--> statement-breakpoint
CREATE TABLE "piqueo" (
	"id" serial PRIMARY KEY NOT NULL,
	"tipo" "tipo_piqueo" NOT NULL,
	"pedido_id" integer NOT NULL,
	"pedido_linea_id" integer,
	"caja_id" integer,
	"despacho_id" integer,
	"codigo_leido" text NOT NULL,
	"cantidad" integer NOT NULL,
	"con_alerta" boolean DEFAULT false NOT NULL,
	"motivo_alerta" text,
	"usuario_id" integer NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "producto" (
	"id" serial PRIMARY KEY NOT NULL,
	"numero" text NOT NULL,
	"codigo" text NOT NULL,
	"descripcion" text NOT NULL,
	"familia" "familia" NOT NULL,
	"tipo" "tipo_producto" NOT NULL,
	"tipo_codigo" text NOT NULL,
	"color_id" integer NOT NULL,
	"proveedor_master_id" integer,
	"m2_por_unidad" numeric(8, 4),
	"kg_por_unidad" numeric(8, 4),
	"piezas_por_golpe" integer,
	"unidades_por_caja" integer,
	"peso_caja_kg" numeric(8, 3),
	"minimo" integer,
	"maximo" integer,
	"es_accesorio" boolean DEFAULT false NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"observaciones" text,
	CONSTRAINT "producto_codigo_unique" UNIQUE("codigo"),
	CONSTRAINT "producto_identidad_uq" UNIQUE("familia","tipo","color_id","proveedor_master_id")
);
--> statement-breakpoint
CREATE TABLE "proveedor_master" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"inicial" text NOT NULL,
	CONSTRAINT "proveedor_master_nombre_unique" UNIQUE("nombre"),
	CONSTRAINT "proveedor_master_inicial_unique" UNIQUE("inicial")
);
--> statement-breakpoint
CREATE TABLE "ratio_master" (
	"id" serial PRIMARY KEY NOT NULL,
	"color_id" integer NOT NULL,
	"proveedor_master_id" integer,
	"materia_prima_id" integer NOT NULL,
	"kg_por_kg_mp" numeric(8, 5) NOT NULL,
	"provisorio" boolean DEFAULT true NOT NULL,
	CONSTRAINT "ratio_master_uq" UNIQUE("color_id","proveedor_master_id")
);
--> statement-breakpoint
CREATE TABLE "receta_producto" (
	"id" serial PRIMARY KEY NOT NULL,
	"producto_id" integer NOT NULL,
	"materia_prima_id" integer NOT NULL,
	"porcentaje" numeric(6, 3) NOT NULL,
	CONSTRAINT "receta_producto_uq" UNIQUE("producto_id","materia_prima_id")
);
--> statement-breakpoint
CREATE TABLE "reserva" (
	"id" serial PRIMARY KEY NOT NULL,
	"deposito_id" integer NOT NULL,
	"producto_id" integer NOT NULL,
	"pedido_linea_id" integer NOT NULL,
	"cantidad" numeric(14, 3) NOT NULL,
	"estado" "estado_reserva" DEFAULT 'ABIERTA' NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	"cerrado_en" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "retiro_mp" (
	"id" serial PRIMARY KEY NOT NULL,
	"fecha" date NOT NULL,
	"lote_mp_id" integer NOT NULL,
	"cantidad" numeric(14, 3) NOT NULL,
	"inyectora" text,
	"retira_id" integer NOT NULL,
	"entrega_id" integer,
	"observaciones" text,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saldo" (
	"id" serial PRIMARY KEY NOT NULL,
	"deposito_id" integer NOT NULL,
	"producto_id" integer,
	"materia_prima_id" integer,
	"cantidad" numeric(14, 3) DEFAULT '0' NOT NULL,
	"actualizado_en" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"email" text,
	"password_hash" text,
	"pin_hash" text,
	"rol" "rol" NOT NULL,
	"activo" boolean DEFAULT true NOT NULL,
	"creado_en" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usuario_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "caja" ADD CONSTRAINT "caja_partida_id_partida_id_fk" FOREIGN KEY ("partida_id") REFERENCES "public"."partida"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caja" ADD CONSTRAINT "caja_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "caja" ADD CONSTRAINT "caja_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificado_calidad" ADD CONSTRAINT "certificado_calidad_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificado_calidad" ADD CONSTRAINT "certificado_calidad_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclo_materia_prima" ADD CONSTRAINT "ciclo_materia_prima_ciclo_id_ciclo_produccion_id_fk" FOREIGN KEY ("ciclo_id") REFERENCES "public"."ciclo_produccion"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclo_materia_prima" ADD CONSTRAINT "ciclo_materia_prima_lote_mp_id_lote_mp_id_fk" FOREIGN KEY ("lote_mp_id") REFERENCES "public"."lote_mp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclo_materia_prima" ADD CONSTRAINT "ciclo_materia_prima_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclo_produccion" ADD CONSTRAINT "ciclo_produccion_partida_id_partida_id_fk" FOREIGN KEY ("partida_id") REFERENCES "public"."partida"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclo_produccion" ADD CONSTRAINT "ciclo_produccion_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclo_produccion" ADD CONSTRAINT "ciclo_produccion_operario_id_usuario_id_fk" FOREIGN KEY ("operario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ciclo_produccion" ADD CONSTRAINT "ciclo_produccion_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despacho" ADD CONSTRAINT "despacho_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despacho" ADD CONSTRAINT "despacho_controlado_por_id_usuario_id_fk" FOREIGN KEY ("controlado_por_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despacho_linea" ADD CONSTRAINT "despacho_linea_despacho_id_despacho_id_fk" FOREIGN KEY ("despacho_id") REFERENCES "public"."despacho"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "despacho_linea" ADD CONSTRAINT "despacho_linea_pedido_linea_id_pedido_linea_id_fk" FOREIGN KEY ("pedido_linea_id") REFERENCES "public"."pedido_linea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devolucion" ADD CONSTRAINT "devolucion_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devolucion" ADD CONSTRAINT "devolucion_despacho_id_despacho_id_fk" FOREIGN KEY ("despacho_id") REFERENCES "public"."despacho"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devolucion" ADD CONSTRAINT "devolucion_partida_afectada_id_partida_id_fk" FOREIGN KEY ("partida_afectada_id") REFERENCES "public"."partida"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devolucion" ADD CONSTRAINT "devolucion_supervisor_id_usuario_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devolucion" ADD CONSTRAINT "devolucion_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_fisico" ADD CONSTRAINT "inventario_fisico_deposito_id_deposito_id_fk" FOREIGN KEY ("deposito_id") REFERENCES "public"."deposito"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_fisico" ADD CONSTRAINT "inventario_fisico_responsable_id_usuario_id_fk" FOREIGN KEY ("responsable_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_linea" ADD CONSTRAINT "inventario_linea_inventario_id_inventario_fisico_id_fk" FOREIGN KEY ("inventario_id") REFERENCES "public"."inventario_fisico"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_linea" ADD CONSTRAINT "inventario_linea_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventario_linea" ADD CONSTRAINT "inventario_linea_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_mp" ADD CONSTRAINT "lote_mp_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lote_mp" ADD CONSTRAINT "lote_mp_certificado_id_certificado_calidad_id_fk" FOREIGN KEY ("certificado_id") REFERENCES "public"."certificado_calidad"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento" ADD CONSTRAINT "movimiento_deposito_id_deposito_id_fk" FOREIGN KEY ("deposito_id") REFERENCES "public"."deposito"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento" ADD CONSTRAINT "movimiento_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento" ADD CONSTRAINT "movimiento_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movimiento" ADD CONSTRAINT "movimiento_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partida" ADD CONSTRAINT "partida_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido" ADD CONSTRAINT "pedido_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido_linea" ADD CONSTRAINT "pedido_linea_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedido_linea" ADD CONSTRAINT "pedido_linea_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piqueo" ADD CONSTRAINT "piqueo_pedido_id_pedido_id_fk" FOREIGN KEY ("pedido_id") REFERENCES "public"."pedido"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piqueo" ADD CONSTRAINT "piqueo_pedido_linea_id_pedido_linea_id_fk" FOREIGN KEY ("pedido_linea_id") REFERENCES "public"."pedido_linea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piqueo" ADD CONSTRAINT "piqueo_caja_id_caja_id_fk" FOREIGN KEY ("caja_id") REFERENCES "public"."caja"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piqueo" ADD CONSTRAINT "piqueo_despacho_id_despacho_id_fk" FOREIGN KEY ("despacho_id") REFERENCES "public"."despacho"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "piqueo" ADD CONSTRAINT "piqueo_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producto" ADD CONSTRAINT "producto_color_id_color_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."color"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "producto" ADD CONSTRAINT "producto_proveedor_master_id_proveedor_master_id_fk" FOREIGN KEY ("proveedor_master_id") REFERENCES "public"."proveedor_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratio_master" ADD CONSTRAINT "ratio_master_color_id_color_id_fk" FOREIGN KEY ("color_id") REFERENCES "public"."color"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratio_master" ADD CONSTRAINT "ratio_master_proveedor_master_id_proveedor_master_id_fk" FOREIGN KEY ("proveedor_master_id") REFERENCES "public"."proveedor_master"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratio_master" ADD CONSTRAINT "ratio_master_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta_producto" ADD CONSTRAINT "receta_producto_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receta_producto" ADD CONSTRAINT "receta_producto_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_deposito_id_deposito_id_fk" FOREIGN KEY ("deposito_id") REFERENCES "public"."deposito"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD CONSTRAINT "retiro_mp_lote_mp_id_lote_mp_id_fk" FOREIGN KEY ("lote_mp_id") REFERENCES "public"."lote_mp"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD CONSTRAINT "retiro_mp_retira_id_usuario_id_fk" FOREIGN KEY ("retira_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retiro_mp" ADD CONSTRAINT "retiro_mp_entrega_id_usuario_id_fk" FOREIGN KEY ("entrega_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldo" ADD CONSTRAINT "saldo_deposito_id_deposito_id_fk" FOREIGN KEY ("deposito_id") REFERENCES "public"."deposito"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldo" ADD CONSTRAINT "saldo_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saldo" ADD CONSTRAINT "saldo_materia_prima_id_materia_prima_id_fk" FOREIGN KEY ("materia_prima_id") REFERENCES "public"."materia_prima"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "caja_partida_idx" ON "caja" USING btree ("partida_id");--> statement-breakpoint
CREATE INDEX "caja_estado_idx" ON "caja" USING btree ("producto_id","estado");--> statement-breakpoint
CREATE INDEX "ciclo_mp_idx" ON "ciclo_materia_prima" USING btree ("ciclo_id");--> statement-breakpoint
CREATE INDEX "ciclo_partida_idx" ON "ciclo_produccion" USING btree ("partida_id");--> statement-breakpoint
CREATE INDEX "ciclo_fecha_idx" ON "ciclo_produccion" USING btree ("fecha_inicio");--> statement-breakpoint
CREATE UNIQUE INDEX "cliente_nombre_uq" ON "cliente" USING btree ("nombre");--> statement-breakpoint
CREATE INDEX "cliente_cuit_idx" ON "cliente" USING btree ("cuit");--> statement-breakpoint
CREATE INDEX "despacho_pedido_idx" ON "despacho" USING btree ("pedido_id");--> statement-breakpoint
CREATE INDEX "despacho_linea_idx" ON "despacho_linea" USING btree ("despacho_id");--> statement-breakpoint
CREATE INDEX "devolucion_pedido_idx" ON "devolucion" USING btree ("pedido_id");--> statement-breakpoint
CREATE INDEX "inventario_linea_idx" ON "inventario_linea" USING btree ("inventario_id");--> statement-breakpoint
CREATE INDEX "lote_mp_material_idx" ON "lote_mp" USING btree ("materia_prima_id","fecha_ingreso");--> statement-breakpoint
CREATE INDEX "movimiento_producto_idx" ON "movimiento" USING btree ("deposito_id","producto_id","fecha");--> statement-breakpoint
CREATE INDEX "movimiento_mp_idx" ON "movimiento" USING btree ("deposito_id","materia_prima_id","fecha");--> statement-breakpoint
CREATE INDEX "movimiento_origen_idx" ON "movimiento" USING btree ("origen","origen_id");--> statement-breakpoint
CREATE INDEX "movimiento_lote_idx" ON "movimiento" USING btree ("lote_mp_id");--> statement-breakpoint
CREATE INDEX "movimiento_partida_idx" ON "movimiento" USING btree ("partida_id");--> statement-breakpoint
CREATE INDEX "pedido_estado_idx" ON "pedido" USING btree ("estado","prioridad");--> statement-breakpoint
CREATE INDEX "pedido_cliente_idx" ON "pedido" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "pedido_linea_pedido_idx" ON "pedido_linea" USING btree ("pedido_id");--> statement-breakpoint
CREATE INDEX "piqueo_pedido_idx" ON "piqueo" USING btree ("pedido_id","tipo");--> statement-breakpoint
CREATE INDEX "producto_familia_tipo_idx" ON "producto" USING btree ("familia","tipo");--> statement-breakpoint
CREATE INDEX "reserva_disponible_idx" ON "reserva" USING btree ("deposito_id","producto_id","estado");--> statement-breakpoint
CREATE INDEX "reserva_linea_idx" ON "reserva" USING btree ("pedido_linea_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saldo_producto_uq" ON "saldo" USING btree ("deposito_id","producto_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saldo_mp_uq" ON "saldo" USING btree ("deposito_id","materia_prima_id");--> statement-breakpoint
CREATE INDEX "usuario_rol_idx" ON "usuario" USING btree ("rol");