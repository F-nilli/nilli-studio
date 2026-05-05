-- Convert tasks.due_date from timestamp (without time zone) to timestamptz.
--
-- Previously the column was a naive timestamp, so its meaning depended on the
-- writer's session timezone and on whoever read it making the right assumption
-- about which zone the wall-clock value referred to. That made it impossible
-- to render deadlines correctly to users in different timezones.
--
-- The Supabase session timezone is UTC, so every existing value is already a
-- UTC literal — `AT TIME ZONE 'UTC'` tags it as a UTC moment without any
-- numeric conversion, preserving every existing deadline.

ALTER TABLE tasks
  ALTER COLUMN due_date TYPE timestamptz
  USING due_date AT TIME ZONE 'UTC';
