-- Fix: member submissions to in_review were being rejected.
--
-- Root cause: trg_bump_submission_count (BEFORE UPDATE OF status) sets
-- NEW.submission_count on every transition into in_review. guard_task_update
-- then ran and saw a member "modifying" submission_count — a column on its
-- frozen list — and raised, rolling back the entire submit. Admins/ops never
-- hit this because the guard returns early for them. The pg_trigger_depth()
-- bypass (Batch B) didn't help: sibling BEFORE triggers on the same statement
-- both run at depth 1.
--
-- Fix: stop FREEZING submission_count; VALIDATE it instead. The bump trigger
-- fires before the guard (alphabetical trigger order), so by the time the
-- guard inspects NEW the counter already holds the system-computed value:
--   - transitioning INTO in_review  → must be exactly OLD + 1
--   - anything else                 → must be unchanged
-- This keeps the protection (a member hand-editing the counter via the API
-- is still rejected) while allowing the system's own bump.

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
  -- submission_count is NOT here — it is validated separately below.
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
     OR NEW.created_at      IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'These task fields can only be changed by an admin or ops manager';
  END IF;

  -- ── submission_count: validate, don't freeze ───────────────────────────
  -- trg_bump_submission_count (BEFORE UPDATE OF status, fires before this
  -- trigger) has already set the correct counter value by the time we run.
  -- We verify that value instead of freezing the column:
  --   moving INTO in_review → counter must be exactly old + 1
  --   anything else         → counter must be untouched
  -- A member hand-setting the counter to any other value is rejected.
  IF NEW.status = 'in_review' AND OLD.status IS DISTINCT FROM 'in_review' THEN
    IF NEW.submission_count IS DISTINCT FROM COALESCE(OLD.submission_count, 0) + 1 THEN
      RAISE EXCEPTION 'submission_count can only be advanced by the system';
    END IF;
  ELSIF NEW.submission_count IS DISTINCT FROM OLD.submission_count THEN
    RAISE EXCEPTION 'submission_count can only be advanced by the system';
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
