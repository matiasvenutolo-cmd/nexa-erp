ALTER TABLE "usuario" ADD COLUMN "email_alternativo" text;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_email_alternativo_unique" UNIQUE("email_alternativo");