ALTER TABLE "sessions" ADD COLUMN "counted" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "streak_before" jsonb;