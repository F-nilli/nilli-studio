-- Migration: add attachments column to comments table
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query)

alter table public.comments
  add column if not exists attachments jsonb default '[]'::jsonb;
