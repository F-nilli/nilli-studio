-- Migration: Enforce the task workflow and inbox rules at the database level.
--
-- Background
-- ──────────
-- Until now the tasks table allowed ANY logged-in user to INSERT and UPDATE
-- ANY task, and the notifications table allowed ANY logged-in user to INSERT
-- a notification into ANY inbox. The app's buttons hid these powers from
-- members, but the database didn't — anyone could open the browser console
-- and approve their own work, reassign tasks, move due dates, unlock locked
-- tasks, or fake a notification to a colleague. The approval workflow was
-- theater: enforced by the UI only.
--
-- Fix
-- ───
--   TASKS
--   A. INSERT: only admins/ops managers (tasks are created on their
--      episode-creation pages; members never create tasks).
--   B. UPDATE: admins/ops managers update any task; members update only
--      tasks where they are the assignee or the named approver.
--   C. Column + transition guard (trigger): for non-admin/ops callers,
--      structural fields (assignee, due date, dependencies, approval
--      wiring, brief, ...) are frozen, and status changes must follow the
--      real workflow:
--        assignee : in_progress|revision → in_review (submit/resubmit)
--                   in_progress → done (only when the task has no approver)
--                   undo back to in_progress / in_review (never from locked)
--        approver : in_review → approved|revision, and its undo
--      Unlocking (locked → in_progress) stays server-side only, via the
--      service role and the existing security-definer trigger.
--
--   NOTIFICATIONS
--   D. INSERT: admins/ops managers (their pages write inbox items
--      directly) — everyone else now goes through the validated
--      /api/notifications/send route, which uses the service role.
--
-- Run this in the Supabase SQL Editor AFTER migration_protect_user_management.sql.

-- ─── A. Task inserts: admins/ops only ───────────────────────────────────────

DROP POLICY IF EXISTS "Authenticated users can insert tasks" ON public.tasks;

CREATE POLICY "Admins and ops managers can insert tasks"
  ON public.tasks
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'ops_manager')
    )
  );

-- ─── B. Task updates: scoped to role / assignee / approver ──────────────────

DROP POLICY IF EXISTS "Authenticated users can update tasks" ON public.tasks;

CREATE POLICY "Admins and ops managers can update any task"
  ON public.tasks
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'ops_manager')
    )
  );

CREATE POLICY "Assignees and approvers can update their tasks"
  ON public.tasks
  FOR UPDATE
  USING (auth.uid() = assignee_id OR auth.uid() = approver_id);

-- ─── C. Column + transition guard for non-admin/ops callers ─────────────────

CREATE OR REPLACE FUNCTION public.guard_task_update()
RETURNS trigger AS $$
DECLARE
  jwt_role text;
  caller_role text;
BEGIN
  -- Direct SQL and the service-role key: allow (server routes, cron, DB
  -- triggers all run this way). Only police ordinary user sessions.
  jwt_role := current_setting('request.jwt.claims', true)::json ->> 'role';
  IF jwt_role IS NULL OR jwt_role <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  SELECT role INTO caller_role FROM public.users WHERE id = auth.uid();

  -- Admins and ops managers: unrestricted (matches the app UI).
  IF caller_role IN ('admin', 'ops_manager') THEN
    RETURN NEW;
  END IF;

  -- ── Frozen structural columns ──────────────────────────────────────────
  -- Everything not listed stays editable for the assignee/approver:
  -- status (rules below), review_started_at, updated_at.
  IF NEW.episode_id         IS DISTINCT FROM OLD.episode_id
     OR NEW.template_task_id IS DISTINCT FROM OLD.template_task_id
     OR NEW.label           IS DISTINCT FROM OLD.label
     OR NEW.track           IS DISTINCT FROM OLD.track
     OR NEW.assignee_id     IS DISTINCT FROM OLD.assignee_id
     OR NEW.due_date        IS DISTINCT FROM OLD.due_date
     OR NEW.dep_task_ids    IS DISTINCT FROM OLD.dep_task_ids
     OR NEW.requires_approval IS DISTINCT FROM OLD.requires_approval
     OR NEW.approver_id     IS DISTINCT FROM OLD.approver_id
     OR NEW.quantity        IS DISTINCT FROM OLD.quantity
     OR NEW.brief           IS DISTINCT FROM OLD.brief
     OR NEW.note            IS DISTINCT FROM OLD.note
     OR NEW.submission_count IS DISTINCT FROM OLD.submission_count
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'These task fields can only be changed by an admin or ops manager';
  END IF;

  -- ── Status transition rules ────────────────────────────────────────────
  IF NEW.status IS DISTINCT FROM OLD.status THEN

    -- Named approver on this task (a member can hold this role):
    -- review decisions and their undo.
    IF OLD.approver_id IS NOT NULL AND auth.uid() = OLD.approver_id THEN
      IF (OLD.status = 'in_review' AND NEW.status IN ('approved', 'revision'))
         OR (OLD.status IN ('approved', 'revision') AND NEW.status = 'in_review') THEN
        RETURN NEW;
      END IF;
    END IF;

    -- Assignee:
    IF auth.uid() = OLD.assignee_id THEN
      -- Submit for review / resubmit after a send-back.
      IF OLD.status IN ('in_progress', 'revision') AND NEW.status = 'in_review' THEN
        RETURN NEW;
      END IF;
      -- Complete directly — only when the task has no named approver
      -- (mirrors the app's resolvedStatus logic in TaskModal).
      IF OLD.status = 'in_progress' AND NEW.status = 'done' AND OLD.approver_id IS NULL THEN
        RETURN NEW;
      END IF;
      -- Undo (the app's revert feature): back to in_progress or in_review.
      -- Never from locked — unlocking is server-side only.
      IF OLD.status <> 'locked' AND NEW.status IN ('in_progress', 'in_review') THEN
        RETURN NEW;
      END IF;
    END IF;

    RAISE EXCEPTION 'This status change is not allowed for your role on this task';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_guard_task_update ON public.tasks;
CREATE TRIGGER trg_guard_task_update
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.guard_task_update();

-- ─── D. Notification inserts: admins/ops only ───────────────────────────────
-- Member-originated notifications now flow through /api/notifications/send
-- (session-validated, payload-validated, service-role delivery).

DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

CREATE POLICY "Admins and ops managers can insert notifications"
  ON public.notifications
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('admin', 'ops_manager')
    )
  );

NOTIFY pgrst, 'reload schema';
