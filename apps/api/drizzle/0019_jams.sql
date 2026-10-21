CREATE TABLE "jam_members" (
	"jam_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jam_members_jam_id_user_id_pk" PRIMARY KEY("jam_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "jams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"title" text NOT NULL,
	"code" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jams_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "jam_members" ADD CONSTRAINT "jam_members_jam_id_jams_id_fk" FOREIGN KEY ("jam_id") REFERENCES "public"."jams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jam_members" ADD CONSTRAINT "jam_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jams" ADD CONSTRAINT "jams_host_id_users_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jam_members_user_idx" ON "jam_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "jams_ends_idx" ON "jams" USING btree ("ends_at");