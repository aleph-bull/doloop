-- Five more Minimalist themes have a texture since 2026-10-29 (dots on Deep Sea and Dusk Rose,
-- the grid on Linen, Night Shift and Tidepool). Accounts already on one kept the no texture
-- they put on with it; they get the theme's texture too, like Salt Air in 0045.
UPDATE "users"
SET "settings" = jsonb_set(
  "settings",
  '{theme,texture}',
  CASE "settings" -> 'theme' ->> 'backgroundId'
    WHEN 'solid:#1d1e26' THEN '"dots"'::jsonb
    WHEN 'solid:#1a1c23' THEN '"dots"'::jsonb
    ELSE '"grid"'::jsonb
  END
)
WHERE "settings" -> 'theme' ->> 'backgroundId' IN (
    'solid:#1d1e26',
    'solid:#1a1c23',
    'solid:#e7e6e3',
    'solid:#313338',
    'solid:#191f1f'
  )
  AND coalesce("settings" -> 'theme' ->> 'texture', 'none') = 'none';
