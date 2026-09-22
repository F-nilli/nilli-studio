-- nilli team app. Run after migration_portal_production.sql.
-- Read the production archive directly, including existing archived projects.
-- No copied completion flag, publication checkbox, backfill or sync job.
begin;
create or replace view public.portal_project_feed with (security_invoker=true) as
select e.id,l.portal_client_id,e.guest_name as title,o.template_name as format,
 e.release_date,e.created_at,d.review_url,coalesce(d.review_ready,false) as review_ready,
 d.publication_url,
 case when e.archived or e.published_at is not null then coalesce(e.completed_at,e.published_at,e.created_at) else null end as published_at,
 case when e.archived or e.published_at is not null then 'published'
 when d.review_ready and d.review_url is not null then 'ready_for_review'
 else 'in_progress' end as status
from public.episodes e
join public.portal_episode_origins o on o.episode_id=e.id
join public.portal_client_templates l on l.production_client_id=o.production_client_id and l.template_name=o.template_name
join public.portal_clients c on c.id=l.portal_client_id and c.active
left join public.portal_project_details d on d.episode_id=e.id;
revoke all on public.portal_project_feed from public,anon,authenticated;
grant select on public.portal_project_feed to service_role;
-- This editor only manages client-safe links/review readiness. Old publication
-- values are retained for reversibility, but never read or changed here.
create or replace function public.portal_save_project(target_client uuid,target_episode uuid,details jsonb,actor uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 perform 1 from portal_clients where id=target_client and active for update;
 if not found then raise exception 'Active client not found'; end if;
 if not exists(select 1 from portal_project_feed where id=target_episode and portal_client_id=target_client) then raise exception 'Project is not associated with this client'; end if;
 insert into portal_project_details(episode_id,review_url,review_ready,publication_url,updated_by)
 values(target_episode,details->>'review_url',(details->>'review_ready')::boolean,details->>'publication_url',actor)
 on conflict(episode_id) do update set review_url=excluded.review_url,review_ready=excluded.review_ready,publication_url=excluded.publication_url,updated_by=excluded.updated_by,updated_at=now();
end $$;
revoke all on function public.portal_save_project(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.portal_save_project(uuid,uuid,jsonb,uuid) to service_role;
commit;
