CREATE TABLE "media_uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "media_uploads" ADD CONSTRAINT "media_uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_uploads_user_created_idx" ON "media_uploads" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "media_uploads_created_idx" ON "media_uploads" USING btree ("created_at");