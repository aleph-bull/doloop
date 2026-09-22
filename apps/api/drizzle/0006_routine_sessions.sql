ALTER TABLE "sessions" ALTER COLUMN "node_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "routine_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "routine_date" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_routine_idx" ON "sessions" USING btree ("routine_id");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_one_subject" CHECK ((node_id IS NULL) <> (routine_id IS NULL));