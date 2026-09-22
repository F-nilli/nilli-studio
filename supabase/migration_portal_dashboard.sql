-- Run in nilli team app after migration_portal_completion_sync.sql.
-- Portal-only package storage and a read-only projection of production release times.
-- Adds optional release timezone metadata; no task, workflow or billing changes.
begin;
alter table public.episodes add column if not exists release_timezone text;

create table if not exists public.portal_client_packages (
 client_id uuid primary key references public.portal_clients(id) on delete cascade,
 name text not null check(length(name) between 1 and 120),
 deliverables text not null default '' check(length(deliverables)<=4000),
 amount numeric(14,2) not null check(amount>=0 and amount<=10000000),
 currency text not null check(currency in ('USD','CAD','EUR','GBP','AUD','MXN')),
 frequency text not null check(frequency in ('monthly','quarterly','annually','per_project','custom')),
 visible boolean not null default false,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.users(id)
);
alter table public.portal_client_packages enable row level security;
revoke all on public.portal_client_packages from public,anon,authenticated;
grant all on public.portal_client_packages to service_role;
create or replace view public.portal_project_feed with (security_invoker=true) as
select e.id,l.portal_client_id,e.guest_name as title,o.template_name as format,
 e.release_date,e.created_at,d.review_url,coalesce(d.review_ready,false) as review_ready,
 d.publication_url,
 case when e.archived or e.published_at is not null then coalesce(e.completed_at,e.published_at,e.created_at) else null end as published_at,
 case when e.archived or e.published_at is not null then 'published'
 when d.review_ready and d.review_url is not null then 'ready_for_review'
 else 'in_progress' end as status,
 case when e.release_time is not null then
 (e.release_date::date + e.release_time::time) at time zone
 coalesce(nullif(e.release_timezone,''),(select nullif(timezone,'') from public.workspace_settings limit 1),'UTC')
 else null end as release_at,
 -- Date-only releases sort at the end of their source day, without displaying a made-up time.
 (e.release_date::date + coalesce(e.release_time::time,time '23:59:59')) at time zone
 coalesce(nullif(e.release_timezone,''),(select nullif(timezone,'') from public.workspace_settings limit 1),'UTC') as release_sort_at
from public.episodes e
join public.portal_episode_origins o on o.episode_id=e.id
join public.portal_client_templates l on l.production_client_id=o.production_client_id and l.template_name=o.template_name
join public.portal_clients c on c.id=l.portal_client_id and c.active
left join public.portal_project_details d on d.episode_id=e.id;
revoke all on public.portal_project_feed from public,anon,authenticated;
grant select on public.portal_project_feed to service_role;
commit;
