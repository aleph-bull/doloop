ALTER TABLE "users" ADD COLUMN "xp_earned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Lifetime XP so far: the balance plus everything the ledger shows spent. Shop and reward lines
-- are what they cost; roll lines are net of what the roll paid back, so each roll counts as its
-- 10 XP (the winnings are already in the balance, and count as XP gained).
UPDATE "users" SET "xp_earned" = "xp" + coalesce((SELECT sum(CASE WHEN t."kind" = 'roll' THEN 10 ELSE -t."delta" END) FROM "xp_transactions" t WHERE t."user_id" = "users"."id" AND (t."kind" = 'roll' OR (t."kind" IN ('freeze', 'break-day', 'background', 'reward') AND t."delta" < 0))), 0);--> statement-breakpoint
-- Never below the level already held, in case some spending predates the ledger (level = floor(sqrt(xp / 100))).
UPDATE "users" SET "xp_earned" = greatest("xp_earned", "level" * "level" * 100);--> statement-breakpoint
-- The level from lifetime XP, which puts back any lost to spending.
UPDATE "users" SET "level" = floor(sqrt("xp_earned" / 100.0))::integer;
