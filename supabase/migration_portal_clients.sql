-- nilli team app. Run immediately before deploying the independent-client UI.
-- Preserves account IDs, invoice ownership, credentials and existing creator access.
begin;
create table if not exists public.portal_clients (
 id uuid primary key default gen_random_uuid(),
 label text not null check(length(trim(label)) between 1 and 120),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
-- Only previously configured portal accounts become clients. Never infer groups by name.
insert into portal_clients(id,label)
select distinct c.id,c.label from clients c join portal_accounts a on a.client_id=c.id
on conflict(id) do nothing;
alter table portal_accounts drop constraint if exists portal_accounts_client_id_fkey;
alter table portal_accounts add constraint portal_accounts_client_id_fkey foreign key(client_id) references portal_clients(id);
create table if not exists public.portal_client_templates (
 production_client_id uuid not null references public.clients(id) on delete cascade,
 template_name text not null,
 portal_client_id uuid not null references public.portal_clients(id),
 primary key(production_client_id,template_name)
);
-- A deleted workflow loses its association, not its billing client or invoices.
create or replace function public.portal_clean_template_link() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from task_templates where client_id=old.client_id and coalesce(nullif(template_name,''),'Default')=coalesce(nullif(old.template_name,''),'Default')) then
 delete from portal_client_templates where production_client_id=old.client_id and template_name=coalesce(nullif(old.template_name,''),'Default');
 end if;
 return null;
end $$;
drop trigger if exists portal_template_link_cleanup on public.task_templates;
create trigger portal_template_link_cleanup after delete or update of client_id,template_name on public.task_templates for each row execute function public.portal_clean_template_link();
create or replace function public.portal_client_access_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare allowed boolean;
begin
 select active into allowed from portal_clients where id=new.client_id for update;
 if new.enabled and not coalesce(allowed,false) then raise exception 'Archived client cannot be enabled'; end if;
 return new;
end $$;
drop trigger if exists portal_client_access_guard on portal_accounts;
create trigger portal_client_access_guard before insert or update on portal_accounts for each row execute function portal_client_access_guard();
create or replace function public.portal_set_client_active(target_id uuid,is_active boolean) returns void
language plpgsql security definer set search_path=public as $$
begin
 update portal_clients set active=is_active where id=target_id;
 if not found then raise exception 'Client not found'; end if;
 if not is_active then update portal_accounts set enabled=false where client_id=target_id; end if;
end $$;
create or replace function public.portal_assign_templates(target_id uuid, selections jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare item jsonb;
begin
 perform 1 from portal_clients where id=target_id and active for update;
 if not found then raise exception 'Active client not found'; end if;
 delete from portal_client_templates where portal_client_id=target_id;
 for item in select * from jsonb_array_elements(selections) loop
 if not exists(select 1 from task_templates where client_id=(item->>'production_client_id')::uuid and coalesce(nullif(template_name,''),'Default')=item->>'template_name') then raise exception 'Template no longer exists'; end if;
 insert into portal_client_templates(production_client_id,template_name,portal_client_id) values((item->>'production_client_id')::uuid,item->>'template_name',target_id);
 end loop;
end $$;
alter table portal_clients enable row level security;
alter table portal_client_templates enable row level security;
revoke all on portal_clients,portal_client_templates from anon,authenticated;
grant all on portal_clients,portal_client_templates to service_role;
revoke all on function portal_set_client_active(uuid,boolean),portal_assign_templates(uuid,jsonb),portal_clean_template_link(),portal_client_access_guard() from public,anon,authenticated;
grant execute on function portal_set_client_active(uuid,boolean),portal_assign_templates(uuid,jsonb) to service_role;
commit;
