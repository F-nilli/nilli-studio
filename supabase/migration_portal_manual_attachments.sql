-- Run in nilli team app after migration_portal_manual_invoices.sql.
begin;
alter table public.portal_manual_invoices add column if not exists mime_type text not null default 'application/pdf' check(mime_type in ('application/pdf','image/jpeg','image/png'));
update storage.buckets set allowed_mime_types=array['application/pdf','image/jpeg','image/png'] where id='portal-invoice-archive';
commit;
