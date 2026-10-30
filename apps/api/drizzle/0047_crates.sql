CREATE TABLE "crate_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier" integer NOT NULL,
	"source" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"item" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_items_user_id_kind_item_pk" PRIMARY KEY("user_id","kind","item")
);
--> statement-breakpoint
ALTER TABLE "crate_offers" ADD CONSTRAINT "crate_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crate_offers_user_idx" ON "crate_offers" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "inventory_items_item_idx" ON "inventory_items" USING btree ("kind","item");