-- Migration: Add task_notifications preferences to workspace_settings
-- Run in Supabase SQL Editor

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS task_notifications jsonb DEFAULT '{"deadline_reminder": true, "overdue": true}';

NOTIFY pgrst, 'reload schema';
