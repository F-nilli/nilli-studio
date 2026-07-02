-- Add brief column to tasks table for per-task rich-text instructions
-- (e.g. thumbnail briefs written by admin/ops_manager, visible to the assignee)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS brief text;
