-- Migration: Enable RLS and add policies for activity_log, clients, task_templates, workspace_settings
-- Run in Supabase SQL Editor

-- Enable RLS on all 4 tables
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_settings ENABLE ROW LEVEL SECURITY;

-- ─── activity_log ────────────────────────────────────────────────────────────
-- Only admins and ops_managers can view activity (mirrors canAccessSettings)
CREATE POLICY "Admins and ops managers can view activity log"
  ON public.activity_log
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('admin', 'ops_manager')
    )
  );

-- Inserts are typically written by DB triggers (security definer, bypasses RLS).
-- This policy covers any future app-level writes.
CREATE POLICY "Authenticated users can insert activity log"
  ON public.activity_log
  FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ─── clients ─────────────────────────────────────────────────────────────────
-- Read: admin/ops_manager (new episode page + settings page both guard with canCreateProject/canAccessSettings)
CREATE POLICY "Admins and ops managers can view clients"
  ON public.clients
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('admin', 'ops_manager')
    )
  );

CREATE POLICY "Admins and ops managers can insert clients"
  ON public.clients
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('admin', 'ops_manager')
    )
  );

CREATE POLICY "Admins and ops managers can update clients"
  ON public.clients
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('admin', 'ops_manager')
    )
  );

CREATE POLICY "Admins and ops managers can delete clients"
  ON public.clients
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('admin', 'ops_manager')
    )
  );

-- ─── task_templates ───────────────────────────────────────────────────────────
-- Read: admin/ops_manager (new episode page + settings page; API routes use admin client)
CREATE POLICY "Admins and ops managers can view task templates"
  ON public.task_templates
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('admin', 'ops_manager')
    )
  );

CREATE POLICY "Admins and ops managers can insert task templates"
  ON public.task_templates
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('admin', 'ops_manager')
    )
  );

CREATE POLICY "Admins and ops managers can update task templates"
  ON public.task_templates
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('admin', 'ops_manager')
    )
  );

CREATE POLICY "Admins and ops managers can delete task templates"
  ON public.task_templates
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role IN ('admin', 'ops_manager')
    )
  );

-- ─── workspace_settings ───────────────────────────────────────────────────────
-- All current access is via admin client (bypasses RLS). These policies are
-- defense-in-depth in case a user-client path is added later.
CREATE POLICY "Admins can view workspace settings"
  ON public.workspace_settings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role = 'admin'
    )
  );

CREATE POLICY "Admins can update workspace settings"
  ON public.workspace_settings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid()
      AND role = 'admin'
    )
  );

NOTIFY pgrst, 'reload schema';
