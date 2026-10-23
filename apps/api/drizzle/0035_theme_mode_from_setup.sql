-- The Recommended mode (light or dark from the background) is gone (2026-10-23). Accounts
-- that still hold it take the light or dark they picked in the first-time setup's look
-- step, or dark, the default, when they never answered it.
UPDATE "users"
SET "settings" = jsonb_set(
  "settings",
  '{theme,mode}',
  CASE
    WHEN (
      SELECT oa."answers" -> 'look' ->> 'dark'
      FROM "onboarding_answers" oa
      WHERE oa."user_id" = "users"."id"
    ) = 'false' THEN '"light"'::jsonb
    ELSE '"dark"'::jsonb
  END
)
WHERE "settings" -> 'theme' ->> 'mode' = 'recommended';
