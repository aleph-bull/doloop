ALTER TABLE "users" ADD COLUMN "dev_account" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dev_world" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "dev_expires_at" timestamp with time zone;