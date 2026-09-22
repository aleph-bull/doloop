ALTER TABLE "planned_blocks" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "planned_blocks" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "planned_blocks" ADD CONSTRAINT "planned_blocks_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;