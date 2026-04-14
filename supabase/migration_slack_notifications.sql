-- Migration: Add slack_notifications preferences column to workspace_settings
-- Run in Supabase SQL Editor

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS slack_notifications jsonb DEFAULT '{}';

NOTIFY pgrst, 'reload schema';
