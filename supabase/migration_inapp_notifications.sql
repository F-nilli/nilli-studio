-- Migration: Add inapp_notifications preferences column to workspace_settings
-- Controls per-event in-app and push notification delivery

ALTER TABLE public.workspace_settings
  ADD COLUMN IF NOT EXISTS inapp_notifications JSONB DEFAULT '{}'::jsonb;
