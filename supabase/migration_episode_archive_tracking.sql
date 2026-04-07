-- Add archive tracking columns to episodes table
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS archived boolean DEFAULT false;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS restored_at timestamptz;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS restore_count integer DEFAULT 0;

-- Backfill: episodes with published_at are archived and completed
UPDATE episodes SET
  archived = true,
  completed_at = published_at
WHERE published_at IS NOT NULL;

-- Indexes for analytics queries
CREATE INDEX IF NOT EXISTS idx_episodes_archived ON episodes(archived);
CREATE INDEX IF NOT EXISTS idx_episodes_completed_at ON episodes(completed_at);
CREATE INDEX IF NOT EXISTS idx_episodes_restored_at ON episodes(restored_at);
