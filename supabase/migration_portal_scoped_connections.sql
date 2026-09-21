-- Run in the EXISTING production database (nilli team app), before deployment.
-- Legacy sandbox credentials, mappings and invoices are preserved.
-- Coordinate with deployment: old account-save upserts stop working after this migration.
begin;
create table if not exists public.portal_connections (
 scope text primary key,
 environment text not null check(environment in ('sandbox','production')),
 encrypted_payload text,
 access_expires_at timestamptz,
 state text not null check(state in ('connected','reconnect_required','disconnect_pending','disconnected')),
 last_success_at timestamptz,
 last_error text,
 dirty_version bigint not null default 1,
 synced_version bigint not null default 0,
 updated_at timestamptz not null default now()
);
alter table public.portal_accounts add column if not exists scope text references public.portal_connections(scope);
alter table public.portal_accounts add column if not exists customer_name text;
alter table public.portal_tokens add column if not exists scope text;
-- NULL scopes identify legacy data. The new application never reads them as current.
alter table public.portal_accounts drop constraint if exists portal_accounts_client_id_key;
alter table public.portal_accounts drop constraint if exists portal_accounts_creator_user_id_key;
alter table public.portal_accounts drop constraint if exists portal_accounts_qbo_customer_id_key;
create unique index if not exists portal_accounts_scoped_client on public.portal_accounts(scope,client_id);
create unique index if not exists portal_accounts_scoped_creator on public.portal_accounts(scope,creator_user_id);
create unique index if not exists portal_accounts_scoped_customer on public.portal_accounts(scope,qbo_customer_id);
-- Retain legacy uniqueness; this partial index does NOT support the old upsert API.
create unique index if not exists portal_accounts_legacy_client on public.portal_accounts(client_id) where scope is null;

create table if not exists public.portal_diagnostics (
 id uuid primary key default gen_random_uuid(),
 scope text not null,
 operation text not null,
 http_status integer,
 intuit_tid text,
 code text not null,
 created_at timestamptz not null default now()
);
create index if not exists portal_diagnostics_created on public.portal_diagnostics(created_at);
alter table public.portal_connections enable row level security;
alter table public.portal_diagnostics enable row level security;
revoke all on public.portal_connections,public.portal_diagnostics from anon,authenticated;
grant all on public.portal_connections,public.portal_diagnostics to service_role;

create or replace function public.portal_mark_scope_dirty(target_scope text)
returns void language sql security definer set search_path=public as $$
 update portal_connections set dirty_version=dirty_version+1
 where scope=target_scope and state='connected';
$$;
revoke all on function public.portal_mark_scope_dirty(text) from public,anon,authenticated;
grant execute on function public.portal_mark_scope_dirty(text) to service_role;
commit;
