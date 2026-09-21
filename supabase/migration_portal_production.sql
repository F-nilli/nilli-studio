-- Run in nilli team app, after migration_portal_clients.sql.
-- Completion is NOT publication: existing delivered/published_at values are not imported.
begin;
create table if not exists public.portal_episode_origins (
 episode_id uuid primary key references public.episodes(id) on delete cascade,
 production_client_id uuid references public.clients(id) on delete set null,
 template_name text not null
);
-- Capture stable production identity. Fail closed if a legacy key is ambiguous.
insert into public.portal_episode_origins(episode_id,production_client_id,template_name)
select e.id,c.id,coalesce(nullif(e.template_name,''),'Default') from public.episodes e
left join public.clients c on c.key=e.client_key and (select count(*) from public.clients x where x.key=e.client_key)=1
on conflict(episode_id) do nothing;
create or replace function public.portal_capture_episode_origin() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 insert into portal_episode_origins(episode_id,production_client_id,template_name)
 values(new.id,(select min(c.id::text)::uuid from clients c where c.key=new.client_key having count(*)=1),coalesce(nullif(new.template_name,''),'Default'))
 on conflict(episode_id) do nothing;
 return new;
end $$;
drop trigger if exists portal_capture_episode_origin on public.episodes;
create trigger portal_capture_episode_origin after insert on public.episodes for each row execute function public.portal_capture_episode_origin();
create table if not exists public.portal_project_details (
 episode_id uuid primary key references public.episodes(id) on delete cascade,
 review_url text,
 review_ready boolean not null default false,
 publication_url text,
 published_at timestamptz,
 updated_at timestamptz not null default now(),
 updated_by uuid references public.users(id),
 check (not review_ready or review_url is not null)
);
alter table public.portal_episode_origins enable row level security;
alter table public.portal_project_details enable row level security;
revoke all on public.portal_episode_origins,public.portal_project_details from anon,authenticated;
grant all on public.portal_episode_origins,public.portal_project_details to service_role;
revoke all on function public.portal_capture_episode_origin() from public,anon,authenticated;
-- Only service-role readers may access this allowlisted projection. Every API read
-- must constrain portal_client_id from the authenticated creator account.
create or replace view public.portal_project_feed with (security_invoker=true) as
select e.id,l.portal_client_id,e.guest_name as title,o.template_name as format,
 e.release_date,e.created_at,d.review_url,coalesce(d.review_ready,false) as review_ready,
 d.publication_url,d.published_at,
 case when d.published_at is not null then 'published'
 when d.review_ready and d.review_url is not null then 'ready_for_review'
 when e.archived or e.completed_at is not null then 'awaiting_publication'
 else 'in_progress' end as status
from public.episodes e
join public.portal_episode_origins o on o.episode_id=e.id
join public.portal_client_templates l on l.production_client_id=o.production_client_id and l.template_name=o.template_name
join public.portal_clients c on c.id=l.portal_client_id and c.active
left join public.portal_project_details d on d.episode_id=e.id;
revoke all on public.portal_project_feed from public,anon,authenticated;
grant select on public.portal_project_feed to service_role;
create or replace function public.portal_save_project(target_client uuid,target_episode uuid,details jsonb,actor uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 -- Same lock as template assignment/archive, so a concurrent reassignment cannot
 -- change ownership between validation and writing client-facing details.
 perform 1 from portal_clients where id=target_client and active for update;
 if not found then raise exception 'Active client not found'; end if;
 if not exists(select 1 from portal_project_feed where id=target_episode and portal_client_id=target_client) then raise exception 'Project is not associated with this client'; end if;
 if (details->>'published_at')::timestamptz > now() then raise exception 'Publication date cannot be in the future'; end if;
 insert into portal_project_details(episode_id,review_url,review_ready,publication_url,published_at,updated_by)
 values(target_episode,details->>'review_url',(details->>'review_ready')::boolean,details->>'publication_url',(details->>'published_at')::timestamptz,actor)
 on conflict(episode_id) do update set review_url=excluded.review_url,review_ready=excluded.review_ready,publication_url=excluded.publication_url,published_at=excluded.published_at,updated_by=excluded.updated_by,updated_at=now();
end $$;
revoke all on function public.portal_save_project(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.portal_save_project(uuid,uuid,jsonb,uuid) to service_role;
commit;
