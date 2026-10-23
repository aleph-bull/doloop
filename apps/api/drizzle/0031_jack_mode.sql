-- Jack mode (2026-10-22): a die after each work interval decides the break. It is off for
-- everyone by default; the owner asked for it to be on for Jack Chow once this is pushed.
-- The name lives in settings.profile.name; dev accounts are left alone.
UPDATE users
SET settings = settings || jsonb_build_object(
  'pomodoro', coalesce(settings -> 'pomodoro', '{}'::jsonb) || '{"jackMode": true}'::jsonb
)
WHERE dev_account = false
  AND lower(regexp_replace(trim(settings -> 'profile' ->> 'name'), '\s+', ' ', 'g')) = 'jack chow';
