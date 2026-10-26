ALTER TABLE "users" ADD COLUMN "roll_stats" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
-- Rolls made since RNG Rolls went live: which rarities each person has landed, for Full house.
UPDATE "users" SET "roll_stats" = jsonb_build_object('hit', r."hit") FROM (SELECT "user_id", bit_or(1 << ("ref")::int)::int AS "hit" FROM "xp_transactions" WHERE "kind" = 'roll' GROUP BY "user_id") r WHERE r."user_id" = "users"."id";
