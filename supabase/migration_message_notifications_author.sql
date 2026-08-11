-- Migration: Bind message_notifications.author_id to the real caller.
--
-- The old INSERT policy allowed any logged-in user to insert a message
-- notification with ANY author_id — i.e. forge "X mentioned you" as someone
-- else. Today all legitimate inserts flow through /api/notifications/comment
-- (service role, which bypasses RLS and now derives the author from the
-- session + database), so no client path needs direct inserts at all.
-- This policy is defense in depth: if a client-side insert path is ever
-- added, the author must be the caller.
--
-- Run this in the Supabase SQL Editor after migration_task_workflow_rls.sql.

DROP POLICY IF EXISTS "Authenticated users can insert message notifications"
  ON public.message_notifications;

CREATE POLICY "Users can insert their own authored message notifications"
  ON public.message_notifications
  FOR INSERT
  WITH CHECK (author_id = auth.uid());

NOTIFY pgrst, 'reload schema';
