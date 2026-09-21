-- Run in nilli team app, after migration_portal_scoped_connections.sql.
begin;
create table if not exists public.portal_manual_invoices (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.portal_accounts(id),
 doc_number text not null check(length(doc_number) between 1 and 80),
 invoice_date date not null,
 due_date date,
 currency text not null check(currency ~ '^[A-Z]{3}$'),
 total numeric(14,2) not null check(total>0),
 balance numeric(14,2) not null check(balance>=0 and balance<=total),
 storage_path text not null unique,
 file_hash text not null,
 created_by uuid not null references public.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz
);
create unique index if not exists portal_manual_number on public.portal_manual_invoices(account_id,lower(doc_number),currency) where deleted_at is null;
create unique index if not exists portal_manual_file on public.portal_manual_invoices(account_id,file_hash) where deleted_at is null;
alter table public.portal_manual_invoices enable row level security;
revoke all on public.portal_manual_invoices from anon,authenticated;
grant all on public.portal_manual_invoices to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('portal-invoice-archive','portal-invoice-archive',false,3145728,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=3145728,allowed_mime_types=array['application/pdf'];
-- Restrict this bucket even if another application has broad permissive policies.
drop policy if exists portal_archive_service_only on storage.objects;
create policy portal_archive_service_only on storage.objects as restrictive
for all to anon,authenticated
using (bucket_id <> 'portal-invoice-archive')
with check (bucket_id <> 'portal-invoice-archive');
commit;
