CREATE TABLE "post_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"reporter_id" uuid NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "ref" serial NOT NULL;--> statement-breakpoint
UPDATE "posts" SET "ref" = n.rn FROM (SELECT "id", row_number() OVER (ORDER BY "created_at", "id") AS rn FROM "posts") n WHERE "posts"."id" = n."id";--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('posts', 'ref'), coalesce((SELECT max("ref") FROM "posts"), 0) + 1, false);--> statement-breakpoint
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_reports" ADD CONSTRAINT "post_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "post_reports_post_reporter_idx" ON "post_reports" USING btree ("post_id","reporter_id");--> statement-breakpoint
CREATE INDEX "post_reports_created_idx" ON "post_reports" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_ref_unique" UNIQUE("ref");