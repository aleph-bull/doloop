-- Salt Air, setup's light Minimalist look, has dots since 2026-10-29. Accounts already on it
-- kept the no texture they put on with it; they get the dots too.
UPDATE "users"
SET "settings" = jsonb_set("settings", '{theme,texture}', '"dots"'::jsonb)
WHERE "settings" -> 'theme' ->> 'backgroundId' = 'solid:#e2e6e9'
  AND coalesce("settings" -> 'theme' ->> 'texture', 'none') = 'none';
