CREATE TABLE "drill_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"last_result" text NOT NULL,
	"due_on" text NOT NULL,
	"box" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drill_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"session_id" uuid,
	"date" text NOT NULL,
	"ok" integer DEFAULT 0 NOT NULL,
	"shaky" integer DEFAULT 0 NOT NULL,
	"miss" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_topics" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"plan_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"resource" text,
	"practice" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "study_plans" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"weekly_minutes" integer NOT NULL,
	"started_on" text NOT NULL,
	"method" text,
	"mastery_target" real DEFAULT 0.85 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "drill_items" ADD CONSTRAINT "drill_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drill_items" ADD CONSTRAINT "drill_items_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drill_rounds" ADD CONSTRAINT "drill_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drill_rounds" ADD CONSTRAINT "drill_rounds_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drill_rounds" ADD CONSTRAINT "drill_rounds_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_topics" ADD CONSTRAINT "plan_topics_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_topics" ADD CONSTRAINT "plan_topics_plan_id_study_plans_node_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."study_plans"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_topics" ADD CONSTRAINT "plan_topics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "drill_items_node_idx" ON "drill_items" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "drill_items_user_idx" ON "drill_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "drill_rounds_node_idx" ON "drill_rounds" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "drill_rounds_user_idx" ON "drill_rounds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "plan_topics_plan_idx" ON "plan_topics" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "study_plans_user_idx" ON "study_plans" USING btree ("user_id");