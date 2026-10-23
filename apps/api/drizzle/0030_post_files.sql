-- A post carries up to four files (one video, three pictures), each at its place in the carousel.
ALTER TABLE "post_media" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- post_id was the primary key on its own (0018_social_feed, Postgres names it post_media_pkey).
ALTER TABLE "post_media" DROP CONSTRAINT "post_media_pkey";--> statement-breakpoint
ALTER TABLE "post_media" ADD CONSTRAINT "post_media_post_id_position_pk" PRIMARY KEY("post_id","position");--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "friends_only" boolean DEFAULT false NOT NULL;
