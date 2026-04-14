-- Migration: Add active + last_seen_at columns to users
-- Run in Supabase SQL Editor

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;

-- Ensure all existing users are marked active
UPDATE public.users SET active = true WHERE active IS NULL;

NOTIFY pgrst, 'reload schema';
