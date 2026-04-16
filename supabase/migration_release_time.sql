-- Add release_time column to episodes table
-- Stores the time-of-day component of the release (was previously discarded by .slice(0,10))
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS release_time time;
