-- Slack message templates: per-event customizable message text stored on the workspace settings row.
-- Keys are Slack event types (done, approval, review_submitted, revision, comment, reassign,
-- release_date_changed, new_project, episode_delivered); values are plain-text templates with
-- {placeholder} tokens. Empty object = use built-in defaults everywhere.

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS slack_templates jsonb NOT NULL DEFAULT '{}'::jsonb;
