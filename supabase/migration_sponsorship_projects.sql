-- Apply after migration_portal_sponsorships.sql and migration_portal_production.sql.
-- No enrollments, existing bookings or existing episodes are changed automatically.
begin;
alter table public.portal_clients add column if not exists content_nascar boolean not null default false;
alter table public.portal_sponsor_menus add column if not exists open_by_default boolean not null default false;
alter table public.portal_sponsor_opportunities add column if not exists episode_id uuid unique references public.episodes(id) on delete set null;
alter table public.portal_sponsor_opportunities add column if not exists accepting_requests boolean not null default true;
create or replace function public.portal_sponsor_mutate(target_client uuid, actor text, is_staff boolean, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.portal_sponsor_opportunities; req public.portal_sponsor_requests; slot jsonb; result_id uuid; used integer; menu_version integer; action text:=payload->>'action';
begin
 perform 1 from portal_clients where id=target_client and active for update;
 if not found then raise exception 'Active creator not found'; end if;
 if action='program' then
  if not is_staff then raise exception 'Admin required'; end if;
  update portal_clients set content_nascar=(payload->>'enabled')::boolean where id=target_client;
 elsif not (select content_nascar from portal_clients where id=target_client) then
  raise exception 'Creator is not enrolled in Content NASCAR';
 elsif action='defaults' then
  if not is_staff then raise exception 'Staff only'; end if;
  update portal_sponsor_defaults set placements=payload->'placements' where singleton;
 elsif action='menu' then
  select version into menu_version from portal_sponsor_menus where client_id=target_client;
  if coalesce(menu_version,0)<>(payload->>'version')::integer then raise exception 'Menu changed. Refresh before saving'; end if;
  insert into portal_sponsor_menus(client_id,placements,open_by_default) values(target_client,payload->'placements',coalesce((payload->>'open_by_default')::boolean,false))
   on conflict(client_id) do update set placements=excluded.placements,open_by_default=excluded.open_by_default,version=portal_sponsor_menus.version+1;
 elsif action='create' then
  if not is_staff then raise exception 'New opportunities are created in the production app'; end if;
  result_id:=(payload->>'id')::uuid;
  if exists(select 1 from portal_sponsor_opportunities where id=result_id and client_id=target_client) then return jsonb_build_object('id',result_id); end if;
  insert into portal_sponsor_opportunities(id,client_id,details,placements) values(result_id,target_client,payload->'details',payload->'placements');
 else
  select * into op from portal_sponsor_opportunities where id=(payload->>'id')::uuid and client_id=target_client for update;
  if not found then raise exception 'Opportunity not found'; end if;
  result_id:=op.id;
  if action in ('save','submit','approve','return','close','withdraw','availability') and op.version<>(payload->>'version')::integer then raise exception 'Opportunity changed. Refresh before continuing'; end if;
  if action='save' then
   if not is_staff then raise exception 'Episode details are managed by Nilli in the production app'; end if;
   if op.status<>'draft' then raise exception 'Only drafts can be edited'; end if;
   update portal_sponsor_opportunities set details=payload->'details',placements=payload->'placements' where id=op.id;
  elsif action='availability' then
   update portal_sponsor_opportunities set accepting_requests=(payload->>'enabled')::boolean where id=op.id;
  elsif action='submit' then
   if coalesce(op.details->>'topic','')='' or coalesce(op.details->>'description','')='' or coalesce((op.details->>'duration')::integer,0)<1 then raise exception 'Complete the episode brief before review'; end if;
   if op.status<>'draft' or jsonb_array_length(op.placements)=0 then raise exception 'Add an available placement before submitting'; end if;
   if (op.details->>'deadline')::date < current_date then raise exception 'Update the sponsorship deadline'; end if;
   update portal_sponsor_opportunities set status='review',review_note='' where id=op.id;
  elsif action='approve' then
   if not is_staff or op.status<>'review' then raise exception 'Staff review required'; end if;
   if (op.details->>'deadline')::date < current_date then raise exception 'Sponsorship deadline has passed'; end if;
   update portal_sponsor_opportunities set status='approved',share_token=replace(gen_random_uuid()::text||gen_random_uuid()::text,'-','') where id=op.id;
  elsif action='return' then
   if not is_staff or op.status<>'review' then raise exception 'Staff review required'; end if;
   update portal_sponsor_opportunities set status='draft',review_note=payload->>'note' where id=op.id;
  elsif action='withdraw' then
   if op.status<>'review' then raise exception 'Only pending review can be withdrawn'; end if;
   update portal_sponsor_opportunities set status='draft' where id=op.id;
  elsif action='close' then
   if op.status<>'approved' then raise exception 'Only approved opportunities can be closed'; end if;
   update portal_sponsor_opportunities set status='closed' where id=op.id;
  elsif action='request' then
   if not is_staff then raise exception 'Staff intake required'; end if;
   if not op.accepting_requests or op.status<>'approved' or (op.details->>'deadline')::date < current_date then raise exception 'This opportunity is closed to requests'; end if;
   select value into slot from jsonb_array_elements(op.placements) where value->>'key'=payload->>'placement_key';
   if slot is null then raise exception 'Placement not found'; end if;
   select count(*) into used from portal_sponsor_requests where opportunity_id=op.id and placement_key=slot->>'key' and status='confirmed';
   if used >= (slot->>'capacity')::integer then raise exception 'Placement is fully booked'; end if;
   insert into portal_sponsor_requests(opportunity_id,placement_key,brand,email,quote,intake_key)
    values(op.id,slot->>'key',payload->>'brand',payload->>'email',slot,(payload->>'intake_key')::uuid) on conflict(intake_key) do nothing;
  elsif action in ('confirm','decline','cancel') then
   if is_staff and action='confirm' then raise exception 'Only the creator can accept a placement'; end if;
   select * into req from portal_sponsor_requests where id=(payload->>'request_id')::uuid and opportunity_id=op.id for update;
   if not found then raise exception 'Request not found'; end if;
   if action='confirm' then
    if req.status='confirmed' then return jsonb_build_object('id',op.id); end if;
    if not op.accepting_requests or req.status<>'pending' or op.status<>'approved' or (op.details->>'deadline')::date < current_date then raise exception 'Request cannot be accepted'; end if;
    select value into slot from jsonb_array_elements(op.placements) where value->>'key'=req.placement_key;
    select count(*) into used from portal_sponsor_requests where opportunity_id=op.id and placement_key=req.placement_key and status='confirmed';
    if slot is null or used >= (slot->>'capacity')::integer then raise exception 'Placement is fully booked'; end if;
    update portal_sponsor_requests set status='confirmed' where id=req.id;
   elsif action='decline' then
    if req.status<>'pending' then raise exception 'Only pending requests can be declined'; end if;
    update portal_sponsor_requests set status='declined' where id=req.id;
   else
    if not is_staff or req.status not in ('pending','confirmed') then raise exception 'Contact Nilli to cancel this placement'; end if;
    update portal_sponsor_requests set status='cancelled' where id=req.id;
   end if;
  else raise exception 'Unknown action'; end if;
  update portal_sponsor_opportunities set version=version+1,updated_at=now() where id=op.id;
 end if;
 insert into portal_sponsor_events(client_id,opportunity_id,actor,action) values(target_client,result_id,actor,action);
 return jsonb_build_object('id',result_id,'ok',true);
end $$;

-- Invoked after the task bulk insert, before any notifications. Idempotent per project.
create or replace function public.portal_seed_sponsorship(target_episode uuid, actor text, brief jsonb default null)
returns void language plpgsql security definer set search_path=public as $$
declare target uuid; e public.episodes; m public.portal_sponsor_menus; opened boolean;
begin
 select l.portal_client_id into target from portal_episode_origins o
 join portal_client_templates l on l.production_client_id=o.production_client_id and l.template_name=o.template_name
 where o.episode_id=target_episode;
 if target is null then
  if brief is not null then raise exception 'Project is not associated with a Content NASCAR creator'; end if;
  return;
 end if;
 perform 1 from portal_clients where id=target and active and content_nascar for update;
 if not found then
  if brief is not null then raise exception 'Creator is not enrolled in Content NASCAR'; end if;
  return;
 end if;
 -- Recheck mapping after acquiring the same lock as template assignment.
 if not exists(select 1 from portal_episode_origins o join portal_client_templates l on l.production_client_id=o.production_client_id and l.template_name=o.template_name where o.episode_id=target_episode and l.portal_client_id=target) then raise exception 'Project association changed. Try again'; end if;
 select * into e from episodes where id=target_episode;
 select * into m from portal_sponsor_menus where client_id=target;
 opened:=coalesce((brief->>'open')::boolean,m.open_by_default,false);
 insert into portal_sponsor_opportunities(client_id,episode_id,details,placements,accepting_requests)
 values(target,target_episode,jsonb_build_object('title',e.guest_name,'release_date',e.release_date,'topic',coalesce(brief->>'topic',''),'guest',coalesce(brief->>'guest',''),'duration',brief->'duration','description',coalesce(brief->>'description',''),'deadline',coalesce(brief->>'deadline',e.release_date::text)),coalesce(m.placements,'[]'::jsonb),opened)
 on conflict(episode_id) do nothing;
 insert into portal_sponsor_events(client_id,opportunity_id,actor,action)
 select target,id,actor,'project_created' from portal_sponsor_opportunities where episode_id=target_episode;
end $$;
revoke all on function public.portal_seed_sponsorship(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.portal_seed_sponsorship(uuid,text,jsonb) to service_role;
commit;
