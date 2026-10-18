ALTER TABLE "custom_rewards" ADD COLUMN "unlock" text DEFAULT 'xp' NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_rewards" ADD COLUMN "unlock_node_id" uuid;--> statement-breakpoint
ALTER TABLE "custom_rewards" ADD CONSTRAINT "custom_rewards_unlock_node_id_nodes_id_fk" FOREIGN KEY ("unlock_node_id") REFERENCES "public"."nodes"("id") ON DELETE set null ON UPDATE no action;