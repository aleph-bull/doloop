ALTER TABLE "nodes" ADD COLUMN "child_defaults" jsonb;--> statement-breakpoint
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_one_subject";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_one_subject" CHECK ((node_id IS NULL) OR (routine_id IS NULL));
