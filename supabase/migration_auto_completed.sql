-- Add auto_completed flag to distinguish manually-delivered episodes
-- from ones that were archived automatically when all tasks reached done/approved.
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS auto_completed boolean NOT NULL DEFAULT false;
