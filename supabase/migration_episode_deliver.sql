-- Add delivery tracking fields to episodes
ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS delivered_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS delivered_task_snapshot jsonb;
