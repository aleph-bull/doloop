ALTER TABLE "posts" ADD COLUMN "elapsed_minutes" integer;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "ended_at" timestamp with time zone;--> statement-breakpoint
-- Posts that showed their time get the session's start and end (2026-10-22).
UPDATE posts
SET started_at = s.started_at, ended_at = s.ended_at
FROM sessions s
WHERE s.id = posts.session_id AND posts.minutes IS NOT NULL AND s.ended_at IS NOT NULL;
