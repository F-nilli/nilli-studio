-- Migration: Make pipeline spawning race-proof.
--
-- /api/episodes/check-triggers used to check "did we already spawn this
-- pipeline for this episode?" and then insert — two separate steps. Two
-- calls arriving at the same moment both saw "not spawned yet" and both
-- inserted: duplicate episodes with duplicate task sets.
--
-- This partial unique index makes the duplicate physically impossible:
-- one spawned pipeline per (source episode, template), enforced by Postgres
-- itself. The route treats the resulting unique-violation as "already
-- spawned" and skips.
--
-- IMPORTANT: if this fails with "could not create unique index", duplicate
-- spawned episodes already exist in production. Find them with:
--
--   SELECT source_episode_id, template_name, COUNT(*)
--   FROM public.episodes
--   WHERE source_episode_id IS NOT NULL
--   GROUP BY source_episode_id, template_name
--   HAVING COUNT(*) > 1;
--
-- delete/merge the extras, then re-run this migration.
--
-- Run this in the Supabase SQL Editor.

CREATE UNIQUE INDEX IF NOT EXISTS episodes_source_episode_template_unique
  ON public.episodes (source_episode_id, template_name)
  WHERE source_episode_id IS NOT NULL;
