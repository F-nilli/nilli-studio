-- Threaded comments: add parent_comment_id and depth columns
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS parent_comment_id uuid REFERENCES public.comments(id) ON DELETE CASCADE;
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS depth integer DEFAULT 0;

-- Also relax the task_id NOT NULL constraint so episode-level (internal) comments can exist without a task
-- (this was already the case in production — verify before running if unsure)
-- ALTER TABLE public.comments ALTER COLUMN task_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comments_parent_comment_id ON public.comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_episode_id ON public.comments(episode_id);
