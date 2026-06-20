-- Migration: Add api_keys table for external read-only API access
-- Run in Supabase SQL Editor

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists api_keys_key_hash_idx on public.api_keys(key_hash);

-- RLS enabled with NO policies defined: this table is only ever read/written
-- via the service-role client inside admin-gated API routes
-- (app/api/admin/api-keys) and the v1 public API's key-validation helper
-- (lib/apiKeys.ts). No browser session, including an admin's, can read or
-- write this table directly through the anon/authenticated Supabase client.
alter table public.api_keys enable row level security;

NOTIFY pgrst, 'reload schema';
