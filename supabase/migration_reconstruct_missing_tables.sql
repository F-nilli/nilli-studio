-- Migration: reconstruct the tables whose CREATE statements were never
-- committed to the repo.
--
-- Background
-- ──────────
-- Nine tables the app uses every day existed only in the production
-- database — a fresh Supabase project could never run this app, and the
-- repo didn't document reality. This file reconstructs their definitions
-- from the code that reads and writes them.
--
-- Safety
-- ──────
-- Every statement is CREATE ... IF NOT EXISTS: on the production database
-- (where all of these tables already exist) this script is a no-op. Its
-- purposes are (a) fresh setups and (b) documentation. It deliberately
-- does NOT touch RLS on existing tables — policies for clients,
-- task_templates, workspace_settings and activity_log live in
-- migration_rls_remaining_tables.sql.

-- ─── clients ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  last_saved_at timestamptz,
  last_saved_by_name text,
  slack_channel_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─── task_templates ─────────────────────────────────────────────────────────
-- The pipeline definitions episodes are generated from. template_name NULL
-- means the 'Default' pipeline (the UI coalesces NULL → 'Default').
-- approver_id stores a user UUID or a legacy name string (resolved to a
-- UUID at episode-creation time).

CREATE TABLE IF NOT EXISTS public.task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  template_name text,
  seq_id integer NOT NULL,
  label text NOT NULL,
  assignee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  track text NOT NULL,
  due_days integer,
  quantity integer NOT NULL DEFAULT 1,
  note text,
  dep_seq_ids integer[] NOT NULL DEFAULT '{}',
  requires_approval boolean NOT NULL DEFAULT false,
  approver_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (client_id, template_name, seq_id)
);

-- ─── workspace_settings ─────────────────────────────────────────────────────
-- Single-row settings table. The app routes insert the row on first save
-- if none exists; the seed below just makes fresh setups start sane.

CREATE TABLE IF NOT EXISTS public.workspace_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_name text,
  slack_bot_token text,
  slack_notifications jsonb DEFAULT '{}',
  inapp_notifications jsonb DEFAULT '{}'::jsonb,
  task_notifications jsonb DEFAULT '{"deadline_reminder": true, "overdue": true}',
  timezone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.workspace_settings (workspace_name)
SELECT 'My Workspace'
WHERE NOT EXISTS (SELECT 1 FROM public.workspace_settings);

-- ─── task_history ───────────────────────────────────────────────────────────
-- Append-only audit trail of status changes (also used as the activity log:
-- episode-level events are rows with task_id NULL, e.g. to_status 'delivered').

CREATE TABLE IF NOT EXISTS public.task_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  changed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_history_task ON public.task_history (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_history_episode ON public.task_history (episode_id);

-- ─── pipeline_triggers ──────────────────────────────────────────────────────
-- When a task (or whole project) on one pipeline completes, auto-spawn a
-- follow-up episode from another template, offset_days after the source
-- release date. Idempotent via the episodes_source_episode_template_unique
-- index (migration_episode_spawn_unique.sql).

CREATE TABLE IF NOT EXISTS public.pipeline_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  template_name text NOT NULL,
  trigger_type text NOT NULL CHECK (trigger_type IN ('on_task', 'on_project')),
  trigger_seq_id integer,
  offset_days integer NOT NULL DEFAULT 3,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, template_name)
);

-- ─── episode_images ─────────────────────────────────────────────────────────
-- Reference images (mood boards etc.) uploaded to the episode-references
-- storage bucket; this table holds the public URLs.

CREATE TABLE IF NOT EXISTS public.episode_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  url text NOT NULL,
  filename text,
  uploaded_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_episode_images_episode ON public.episode_images (episode_id);

-- ─── comment_reactions ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comment_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id, emoji)
);

-- ─── comment_reads ──────────────────────────────────────────────────────────
-- Referenced by the episode-delete cleanup (episode_id). Read-receipt state.

CREATE TABLE IF NOT EXISTS public.comment_reads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid REFERENCES public.comments(id) ON DELETE CASCADE,
  episode_id uuid REFERENCES public.episodes(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (comment_id, user_id)
);

-- ─── activity_log ───────────────────────────────────────────────────────────
-- Generic event log. Currently only referenced by the episode-delete
-- cleanup (episode-level activity is recorded in task_history instead),
-- but the table exists in production, so it belongs in the repo.

CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid REFERENCES public.episodes(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

NOTIFY pgrst, 'reload schema';
