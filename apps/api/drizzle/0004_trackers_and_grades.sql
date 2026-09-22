CREATE TABLE "grade_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"title" text NOT NULL,
	"weight" real NOT NULL,
	"score" real,
	"sort_order" real DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tracker_id" uuid NOT NULL,
	"date" text NOT NULL,
	"amount" real NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trackers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"unit_label" text NOT NULL,
	"daily_goal" real,
	"color" text,
	"sort_order" real DEFAULT 0 NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "grade_mode" text;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "grade_overall" real;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "grade_credits" real;--> statement-breakpoint
ALTER TABLE "grade_components" ADD CONSTRAINT "grade_components_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grade_components" ADD CONSTRAINT "grade_components_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_entries" ADD CONSTRAINT "tracker_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracker_entries" ADD CONSTRAINT "tracker_entries_tracker_id_trackers_id_fk" FOREIGN KEY ("tracker_id") REFERENCES "public"."trackers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trackers" ADD CONSTRAINT "trackers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "grade_components_user_idx" ON "grade_components" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "grade_components_node_idx" ON "grade_components" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "tracker_entries_user_idx" ON "tracker_entries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracker_entries_day_idx" ON "tracker_entries" USING btree ("tracker_id","date");--> statement-breakpoint
CREATE INDEX "trackers_user_idx" ON "trackers" USING btree ("user_id");