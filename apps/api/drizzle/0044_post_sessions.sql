CREATE TABLE "post_sessions" (
	"session_id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "post_sessions" ADD CONSTRAINT "post_sessions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_sessions" ADD CONSTRAINT "post_sessions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "post_sessions_post_idx" ON "post_sessions" USING btree ("post_id");--> statement-breakpoint
-- Every post so far is about the one session it names (the oldest post, should two name one).
INSERT INTO "post_sessions" ("session_id", "post_id") SELECT DISTINCT ON (p."session_id") p."session_id", p."id" FROM "posts" p WHERE p."session_id" IS NOT NULL ORDER BY p."session_id", p."created_at" ON CONFLICT DO NOTHING;