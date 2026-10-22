CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url_enc" text NOT NULL,
	"url_hash" text NOT NULL,
	"host" text NOT NULL,
	"tasks" boolean DEFAULT true NOT NULL,
	"events" integer DEFAULT 0 NOT NULL,
	"last_sync_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_user_url_idx" ON "calendar_feeds" USING btree ("user_id","url_hash");