-- Version tracking for tasks: every time a task transitions to in_review
-- we bump submission_count. Display as "v{submission_count}" — v1 on first
-- submit, v2 after one revision, v3 after two, etc. Never resets.

-- 1. Add the column. Default 0 means "never submitted".
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS submission_count int NOT NULL DEFAULT 0;

-- 2. Backfill from task_history: each transition into 'in_review' counts
-- as one submission. Tasks resubmitted multiple times will reflect their
-- real version number after this runs.
UPDATE tasks t
SET submission_count = (
  SELECT COUNT(*)
  FROM task_history th
  WHERE th.task_id = t.id
    AND th.to_status = 'in_review'
);

-- 3. Trigger keeps the column in sync going forward, regardless of which
-- code path updates a task. Fires on every UPDATE of status; only does
-- anything when status is moving TO in_review from a different status.
CREATE OR REPLACE FUNCTION public.bump_submission_count()
RETURNS trigger AS $$
BEGIN
  IF NEW.status = 'in_review' AND (OLD.status IS DISTINCT FROM 'in_review') THEN
    NEW.submission_count := COALESCE(OLD.submission_count, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bump_submission_count ON public.tasks;
CREATE TRIGGER trg_bump_submission_count
  BEFORE UPDATE OF status ON public.tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_submission_count();
