CREATE TABLE "achievements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "estimate_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"from_minutes" integer,
	"to_minutes" integer,
	"source" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "google_calendar" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"study_calendar_id" text,
	"sync_token" text,
	"revoked_at" timestamp with time zone,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_id" uuid,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"estimated_minutes" integer,
	"due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"sort_order" real DEFAULT 0 NOT NULL,
	"color" text,
	"archived" boolean DEFAULT false NOT NULL,
	"count_unit" text,
	"count_unit_label" text,
	"outcome_rating" integer,
	"outcome_asked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'app' NOT NULL,
	"google_event_id" text,
	"cancelled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes_seen" (
	"user_id" uuid NOT NULL,
	"date" text NOT NULL,
	"quote_id" text NOT NULL,
	CONSTRAINT "quotes_seen_user_id_date_pk" PRIMARY KEY("user_id","date")
);
--> statement-breakpoint
CREATE TABLE "rest_day_policies" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"weekly_rest_days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending_weekly_rest_days" jsonb,
	"vacations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"break_days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"change_log" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"mode" text NOT NULL,
	"planned_end_at" timestamp with time zone,
	"work_seconds" integer DEFAULT 0 NOT NULL,
	"break_seconds" integer DEFAULT 0 NOT NULL,
	"idle_seconds" integer DEFAULT 0 NOT NULL,
	"pomodoro_config_snapshot" jsonb,
	"review" jsonb,
	"xp_awarded" integer DEFAULT 0 NOT NULL,
	"badges_awarded" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"timer" jsonb NOT NULL,
	"phrase_id" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"xp" integer DEFAULT 0 NOT NULL,
	"level" integer DEFAULT 0 NOT NULL,
	"streak" jsonb DEFAULT '{"current":0,"longest":0,"lastCountedDate":null,"freezesHeld":0,"breakDaysHeld":0}'::jsonb NOT NULL,
	"ics_token" text NOT NULL,
	"purchased_backgrounds" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_phrase_id" text,
	"onboarded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "weekly_reviews" (
	"user_id" uuid NOT NULL,
	"week_start" text NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "weekly_reviews_user_id_week_start_pk" PRIMARY KEY("user_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "xp_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"ref" text
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_changes" ADD CONSTRAINT "estimate_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "estimate_changes" ADD CONSTRAINT "estimate_changes_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "google_calendar" ADD CONSTRAINT "google_calendar_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_blocks" ADD CONSTRAINT "planned_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_blocks" ADD CONSTRAINT "planned_blocks_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes_seen" ADD CONSTRAINT "quotes_seen_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rest_day_policies" ADD CONSTRAINT "rest_day_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_reviews" ADD CONSTRAINT "weekly_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_transactions" ADD CONSTRAINT "xp_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "achievements_user_key_idx" ON "achievements" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "estimate_changes_node_idx" ON "estimate_changes" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "nodes_user_idx" ON "nodes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "nodes_parent_idx" ON "nodes" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "planned_blocks_user_start_idx" ON "planned_blocks" USING btree ("user_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "planned_blocks_google_idx" ON "planned_blocks" USING btree ("user_id","google_event_id");--> statement-breakpoint
CREATE INDEX "sessions_user_started_idx" ON "sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_node_idx" ON "sessions" USING btree ("node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_active_idx" ON "sessions" USING btree ("user_id") WHERE ended_at IS NULL;--> statement-breakpoint
CREATE INDEX "xp_tx_user_at_idx" ON "xp_transactions" USING btree ("user_id","at");