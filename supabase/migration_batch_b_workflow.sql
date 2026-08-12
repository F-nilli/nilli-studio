-- Migration: Batch B — due dates at unlock + guard/trigger conflict fix.
--
-- What this does
-- ──────────────
--   1. tasks.due_days: carries the template's days-before-release offset on
--      each task, so a locked task's due date can be computed WHEN IT
--      UNLOCKS (product spec) instead of being frozen at episode creation.
--      Backfilled from task_templates for existing tasks.
--
--   2. workspace_settings.timezone: canonical workspace timezone used when
--      computing due dates and "due today" for crons. Defaults to UTC —
--      after running this, set your real zone, e.g.:
--        UPDATE public.workspace_settings SET timezone = 'America/New_York';
--
--   3. guard_task_update(): BUG FIX. Updates issued BY database triggers
--      (e.g. trg_unlock_dependent_tasks unlocking dependents) inherit the
--      original caller's JWT — so a member approving a task could have the
--      automatic unlock of the NEXT person's task rejected by the guard,
--      rolling back their whole approval. Trigger-issued updates run at
--      trigger depth ≥ 2 and are now recognized as system actions.
--
--   4. unlock_dependent_tasks(): now also computes due_date at unlock time
--      (release_date − due_days, at release_time, in the workspace
--      timezone) for tasks that don't have one yet.
--
-- Safe to re-run (idempotent). No data is deleted.

-- ─── 1. tasks.due_days ──────────────────────────────────────────────────────

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_days integer;

-- Backfill from the matching template row. Template rows with
-- template_name NULL are the 'Default' pipeline (UI semantics).
UPDATE public.tasks t
SET due_days = tt.due_days
FROM public.episodes e
JOIN public.clients c ON c.key = e.client_key
JOIN public.task_templates tt
  ON tt.client_id = c.id
 AND COALESCE(tt.template_name, 'Default') = COALESCE(e.template_name, 'Default')
 AND tt.seq_id = t.template_task_id
WHERE t.episode_id = e.id
  AND t.due_days IS NULL
  AND tt.due_days IS NOT NULL;

-- ─── 2. workspace_settings.timezone ─────────────────────────────────────────

ALTER TABLE public.workspace_settings ADD COLUMN IF NOT EXISTS timezone text;

-- ─── 3. guard_task_update: let trigger-issued updates through ───────────────

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

  -- Updates issued BY another trigger (e.g. trg_unlock_dependent_tasks
  -- unlocking dependent tasks after an approval) are system actions, not
  -- user input — they run at trigger depth ≥ 2. Without this, a member's
  -- legitimate approval could be rolled back when the automatic unlock of
  -- a colleague's task was policed as if the member had done it by hand.
  IF pg_trigger_depth() > 1 THEN
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

-- ─── 4. unlock_dependent_tasks: compute due dates at unlock ─────────────────

CREATE OR REPLACE FUNCTION public.unlock_dependent_tasks()
RETURNS trigger AS $$
DECLARE
  ws_tz text;
BEGIN
  IF NEW.status IN ('done', 'approved') AND OLD.status NOT IN ('done', 'approved') THEN
    SELECT COALESCE(NULLIF(timezone, ''), 'UTC') INTO ws_tz
    FROM public.workspace_settings LIMIT 1;
    ws_tz := COALESCE(ws_tz, 'UTC');

    UPDATE public.tasks t
    SET status = 'in_progress',
        -- Compute the due date at unlock time for tasks that carry a
        -- due_days offset but no due date yet: release_date − due_days,
        -- at the release time, in the workspace timezone.
        due_date = CASE
          WHEN t.due_date IS NULL AND t.due_days IS NOT NULL THEN
            (((e.release_date - t.due_days)::timestamp + COALESCE(e.release_time, time '09:00')) AT TIME ZONE ws_tz)
          ELSE t.due_date
        END
    FROM public.episodes e
    WHERE t.episode_id = NEW.episode_id
      AND e.id = t.episode_id
      AND t.status = 'locked'
      AND array_length(t.dep_task_ids, 1) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(t.dep_task_ids) AS dep_id
        LEFT JOIN public.tasks t2 ON t2.id = dep_id
        WHERE t2.id IS NULL OR t2.status NOT IN ('done', 'approved')
      );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

NOTIFY pgrst, 'reload schema';
