CREATE TABLE "custom_rewards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"note" text,
	"emoji" text,
	"cost_xp" integer NOT NULL,
	"cooldown_days" integer DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"last_redeemed_at" timestamp with time zone,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routine_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"routine_id" uuid NOT NULL,
	"date" text NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"minutes" integer NOT NULL,
	"xp_awarded" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid,
	"title" text NOT NULL,
	"note" text,
	"estimated_minutes" integer NOT NULL,
	"freq" text NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"by_weekday" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"by_monthday" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text,
	"source" text DEFAULT 'app' NOT NULL,
	"ics_uid" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_rewards" ADD CONSTRAINT "custom_rewards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_completions" ADD CONSTRAINT "routine_completions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routine_completions" ADD CONSTRAINT "routine_completions_routine_id_routines_id_fk" FOREIGN KEY ("routine_id") REFERENCES "public"."routines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routines" ADD CONSTRAINT "routines_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "custom_rewards_user_idx" ON "custom_rewards" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routine_completions_once_idx" ON "routine_completions" USING btree ("routine_id","date");--> statement-breakpoint
CREATE INDEX "routine_completions_user_date_idx" ON "routine_completions" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "routines_user_idx" ON "routines" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routines_ics_uid_idx" ON "routines" USING btree ("user_id","ics_uid");