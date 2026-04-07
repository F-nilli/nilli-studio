-- Migration v3: Message notifications table
-- Run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.message_notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('mention', 'task_comment')),
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.message_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own message notifications" ON public.message_notifications
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Authenticated users can insert message notifications" ON public.message_notifications
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can update own message notifications" ON public.message_notifications
  FOR UPDATE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_msg_notif_user_id ON public.message_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_msg_notif_created_at ON public.message_notifications(created_at DESC);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_notifications;

NOTIFY pgrst, 'reload schema';
