CREATE TABLE "roll_holdings" (
	"user_id" uuid NOT NULL,
	"tier" integer NOT NULL,
	"held" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "roll_holdings_user_id_tier_pk" PRIMARY KEY("user_id","tier")
);
--> statement-breakpoint
ALTER TABLE "roll_holdings" ADD CONSTRAINT "roll_holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Everything rolled so far is held: one per roll, by its rarity.
INSERT INTO "roll_holdings" ("user_id", "tier", "held") SELECT "user_id", ("ref")::int, count(*)::int FROM "xp_transactions" WHERE "kind" = 'roll' GROUP BY "user_id", ("ref")::int ON CONFLICT DO NOTHING;
