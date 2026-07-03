-- ─────────────────────────────────────────────────────────────────────────────
-- Output Quota System
-- Run this in the Supabase SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add quantity to task_templates (how many units this task produces)
ALTER TABLE public.task_templates
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

-- 2. Add quantity to tasks (copied from template at episode creation)
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS quantity integer NOT NULL DEFAULT 1;

-- 3. Create user_quotas table
--    Tracks per-user, per-track monthly caps.
--    Any user can have any number of quotas across different tracks.
CREATE TABLE IF NOT EXISTS public.user_quotas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  track       text        NOT NULL,
  monthly_cap integer     NOT NULL DEFAULT 40,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, track)
);

ALTER TABLE public.user_quotas ENABLE ROW LEVEL SECURITY;

-- Users can read their own quotas (for personal dashboard card)
CREATE POLICY "Users can read own quotas"
  ON public.user_quotas FOR SELECT
  USING (auth.uid() = user_id);

-- Admins can read all quotas
CREATE POLICY "Admins can read all quotas"
  ON public.user_quotas FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- Only admins can insert / update / delete quotas
CREATE POLICY "Admins can manage quotas"
  ON public.user_quotas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
