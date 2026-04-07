-- Migration v2: Internal comments + episode-level comment queries
-- Run this in your Supabase SQL editor

-- 1. Add internal flag to comments
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS internal boolean NOT NULL DEFAULT false;

-- 2. Add episode_id for direct episode queries
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS episode_id uuid REFERENCES public.episodes(id) ON DELETE CASCADE;

-- 3. Make task_id nullable (episode-level internal comments need no task)
ALTER TABLE public.comments ALTER COLUMN task_id DROP NOT NULL;

-- 4. Backfill episode_id for all existing task-linked comments
UPDATE public.comments c
SET episode_id = t.episode_id
FROM public.tasks t
WHERE c.task_id = t.id AND c.episode_id IS NULL;

-- 5. Index for fast episode-level queries
CREATE INDEX IF NOT EXISTS idx_comments_episode_id ON public.comments(episode_id);

-- 6. Update RLS: members cannot read internal comments
DROP POLICY IF EXISTS "Authenticated users can view comments" ON public.comments;
DROP POLICY IF EXISTS "Users can view comments" ON public.comments;
CREATE POLICY "Users can view comments" ON public.comments
  FOR SELECT USING (
    auth.role() = 'authenticated' AND (
      internal = false OR
      EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND role IN ('admin', 'ops_manager')
      )
    )
  );

-- 7. Update insert RLS: only admin/manager can post internal comments
DROP POLICY IF EXISTS "Authenticated users can insert comments" ON public.comments;
DROP POLICY IF EXISTS "Users can insert comments" ON public.comments;
CREATE POLICY "Users can insert comments" ON public.comments
  FOR INSERT WITH CHECK (
    auth.uid() = author_id AND (
      internal = false OR
      EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid()
        AND role IN ('admin', 'ops_manager')
      )
    )
  );

-- 8. Ensure tasks table has required columns (add if missing)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS approver_id uuid REFERENCES public.users(id);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_after_dep_hours integer;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS review_started_at timestamptz;

-- 9. Ensure users table has ops_manager role support
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'ops_manager', 'member'));

-- 10. Add avatar_url if missing
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS avatar_url text;

-- 11. Refresh the schema cache (PostgREST)
NOTIFY pgrst, 'reload schema';
