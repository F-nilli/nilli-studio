-- Apply before deploying the client correction UI. Existing tasks are not reclassified.
BEGIN;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS client_revision_parent_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS client_revision_task_ids uuid[] NOT NULL DEFAULT '{}';

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
  IF NEW.client_revision_parent_id IS DISTINCT FROM OLD.client_revision_parent_id
     OR NEW.client_revision_task_ids IS DISTINCT FROM OLD.client_revision_task_ids
     OR NEW.episode_id         IS DISTINCT FROM OLD.episode_id
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
      IF OLD.status IN ('in_progress', 'revision') AND NEW.status = 'done'
         AND (OLD.approver_id IS NULL OR (OLD.status = 'revision' AND OLD.client_revision_parent_id IS NOT NULL)) THEN
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
      AND cardinality(t.client_revision_task_ids) = 0
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

-- Only the authenticated server route may start a correction round.
CREATE OR REPLACE FUNCTION public.start_client_revision_round(
  p_client_task_id uuid, p_task_ids uuid[], p_due_date timestamptz, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  parent public.tasks;
  child public.tasks;
  ep uuid;
  reopened jsonb := '[]'::jsonb;
BEGIN
  SELECT episode_id INTO ep FROM tasks WHERE id = p_client_task_id;
  -- Serialize rounds for an episode, including concurrent starts.
  PERFORM 1 FROM episodes WHERE id = ep FOR UPDATE;
  PERFORM 1 FROM tasks WHERE episode_id = ep ORDER BY id FOR UPDATE;
  SELECT * INTO parent FROM tasks WHERE id = p_client_task_id;
  IF parent.id IS NULL OR parent.track <> 'Client Action' OR parent.status NOT IN ('in_progress','revision') THEN
    RAISE EXCEPTION 'Client task is not actionable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_actor AND
    (id = parent.assignee_id OR role IN ('admin','ops_manager'))) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF p_due_date IS NULL OR cardinality(p_task_ids) IS NULL OR cardinality(p_task_ids) NOT BETWEEN 1 AND 50
    OR cardinality(p_task_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_task_ids) x) THEN
    RAISE EXCEPTION 'Invalid correction tasks';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_task_ids) x LEFT JOIN tasks t ON t.id = x
    WHERE t.id IS NULL OR t.episode_id <> ep OR NOT (t.id = ANY(coalesce(parent.dep_task_ids, '{}'::uuid[])))
      OR t.status NOT IN ('done','approved')) THEN
    RAISE EXCEPTION 'Corrections must be completed dependencies';
  END IF;
  FOR child IN SELECT * FROM tasks WHERE id = ANY(p_task_ids) LOOP
    UPDATE tasks SET status = 'revision', due_date = p_due_date,
      client_revision_parent_id = parent.id, review_started_at = NULL WHERE id = child.id;
    INSERT INTO task_history(task_id, episode_id, from_status, to_status, changed_by, note)
      VALUES(child.id, ep, child.status, 'revision', p_actor, 'Client requested changes: final correction pass');
  END LOOP;
  UPDATE tasks SET status = 'locked', client_revision_task_ids = p_task_ids WHERE id = parent.id;
  INSERT INTO task_history(task_id, episode_id, from_status, to_status, changed_by, note)
    VALUES(parent.id, ep, parent.status, 'locked', p_actor, 'Waiting for final client corrections');
  SELECT coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO reopened FROM tasks t WHERE id = ANY(p_task_ids);
  SELECT * INTO parent FROM tasks WHERE id = parent.id;
  RETURN jsonb_build_object('clientTask', to_jsonb(parent), 'reopenedTasks', reopened);
END;
$$;
REVOKE ALL ON FUNCTION public.start_client_revision_round(uuid, uuid[], timestamptz, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.start_client_revision_round(uuid, uuid[], timestamptz, uuid) TO service_role;

-- Keep the parent locked until every selected correction is done. The parent
-- row lock serializes concurrent completions so the last one closes the round.
CREATE OR REPLACE FUNCTION public.finish_client_revision_round()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE parent public.tasks;
BEGIN
  IF NEW.client_revision_parent_id IS NULL OR NEW.status = OLD.status THEN RETURN NEW; END IF;
  SELECT * INTO parent FROM tasks WHERE id = NEW.client_revision_parent_id FOR UPDATE;
  IF parent.id IS NULL OR NOT (NEW.id = ANY(parent.client_revision_task_ids)) THEN RETURN NEW; END IF;
  IF NEW.status IN ('done','approved') AND parent.status = 'locked' AND NOT EXISTS (
    SELECT 1 FROM unnest(parent.client_revision_task_ids) x LEFT JOIN tasks t ON t.id = x
    WHERE t.id IS NULL OR t.status NOT IN ('done','approved')
  ) THEN
    UPDATE tasks SET status = 'done' WHERE id = parent.id;
    INSERT INTO task_history(task_id, episode_id, from_status, to_status, changed_by, note)
      VALUES(parent.id, parent.episode_id, 'locked', 'done', auth.uid(), 'All client corrections completed automatically');
  ELSIF NEW.status NOT IN ('done','approved') AND parent.status = 'done' THEN
    UPDATE tasks SET status = 'locked' WHERE id = parent.id;
    INSERT INTO task_history(task_id, episode_id, from_status, to_status, changed_by, note)
      VALUES(parent.id, parent.episode_id, 'done', 'locked', auth.uid(), 'Correction completion reverted');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_finish_client_revision_round ON public.tasks;
CREATE TRIGGER trg_finish_client_revision_round AFTER UPDATE OF status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.finish_client_revision_round();
-- A subsequent INTERNAL review decision must never inherit the client bypass.
CREATE OR REPLACE FUNCTION public.clear_internal_revision_origin()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'in_review' AND NEW.status = 'revision' THEN
    NEW.client_revision_parent_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;
-- Runs after the guard has validated the user's original payload.
DROP TRIGGER IF EXISTS zz_clear_internal_revision_origin ON public.tasks;
CREATE TRIGGER zz_clear_internal_revision_origin BEFORE UPDATE OF status ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.clear_internal_revision_origin();
NOTIFY pgrst, 'reload schema';
COMMIT;
