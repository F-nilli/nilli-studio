-- Additive foundation. Creator auth belongs to a SEPARATE Supabase project.
-- No staff RLS or existing tables are changed. Run as database owner.
begin;
create table if not exists public.portal_accounts (
 id uuid primary key default gen_random_uuid(),
 client_id uuid not null unique references public.clients(id),
 creator_user_id uuid unique, -- ID from the separate creator-auth project, NOT auth.users here
 qbo_customer_id text unique,
 enabled boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.portal_qbo (
 id boolean primary key default true check(id),
 realm_id text not null,
 encrypted_tokens text not null,
 access_expires_at timestamptz not null,
 last_success_at timestamptz,
 last_error text,
 dirty_version bigint not null default 1,
 synced_version bigint not null default 0
);
create table if not exists public.portal_invoices (
 account_id uuid not null references public.portal_accounts(id),
 qbo_id text not null,
 doc_number text,
 invoice_date date,
 due_date date,
 currency text not null,
 total numeric not null,
 balance numeric not null,
 source_updated_at timestamptz not null,
 synced_at timestamptz not null default now(),
 primary key(account_id,qbo_id)
);
create table if not exists public.portal_tokens (
 token_hash text primary key,
 kind text not null check(kind in ('oauth','preview_ticket','preview_session')),
 staff_id uuid not null references public.users(id),
 account_id uuid references public.portal_accounts(id),
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create table if not exists public.portal_locks (
 name text primary key,
 owner uuid not null,
 expires_at timestamptz not null
);
create or replace function public.portal_take_lock(lock_name text, lock_owner uuid)
returns boolean language plpgsql security definer set search_path=public as $$
begin
 insert into portal_locks(name,owner,expires_at) values(lock_name,lock_owner,now()+interval '5 minutes')
 on conflict(name) do update set owner=excluded.owner,expires_at=excluded.expires_at where portal_locks.expires_at<now();
 return found;
end $$;
create or replace function public.portal_mark_dirty()
returns void language sql security definer set search_path=public as $$
 update portal_qbo set dirty_version=dirty_version+1 where id=true;
$$;
-- Replace a full fetched account snapshot atomically. No partial import can erase history.
create or replace function public.portal_replace_invoices(target_account uuid, rows_json jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
 delete from portal_invoices where account_id=target_account;
 insert into portal_invoices(account_id,qbo_id,doc_number,invoice_date,due_date,currency,total,balance,source_updated_at)
 select target_account,x.qbo_id,x.doc_number,x.invoice_date,x.due_date,x.currency,x.total,x.balance,x.source_updated_at
 from jsonb_to_recordset(rows_json) as x(qbo_id text,doc_number text,invoice_date date,due_date date,currency text,total numeric,balance numeric,source_updated_at timestamptz);
end $$;
-- Service-role only, including tokens, mappings and cached financial records.
do $$ declare t text; begin
 foreach t in array array['portal_accounts','portal_qbo','portal_invoices','portal_tokens','portal_locks'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon, authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
revoke all on function public.portal_take_lock(text,uuid), public.portal_mark_dirty(),public.portal_replace_invoices(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.portal_take_lock(text,uuid), public.portal_mark_dirty(),public.portal_replace_invoices(uuid,jsonb) to service_role;
commit;
