ALTER TABLE "post_media" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_media" ADD COLUMN "key" text;