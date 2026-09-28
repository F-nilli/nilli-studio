-- Apply after portal_clients. No production task or billing mutations.
begin;
create table if not exists public.portal_sponsor_menus (
 client_id uuid primary key references public.portal_clients(id),
 placements jsonb not null default '[]' check(jsonb_typeof(placements)='array'),
 version integer not null default 1
);
create table if not exists public.portal_sponsor_defaults (
 singleton boolean primary key default true check(singleton),
 placements jsonb not null default '[]' check(jsonb_typeof(placements)='array')
);
insert into public.portal_sponsor_defaults(singleton) values(true) on conflict do nothing;
create table if not exists public.portal_sponsor_opportunities (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.portal_clients(id),
 details jsonb not null, placements jsonb not null check(jsonb_typeof(placements)='array'),
 status text not null default 'draft' check(status in ('draft','review','approved','closed')),
 review_note text not null default '', share_token text unique,
 version integer not null default 1, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists portal_sponsor_opportunities_client on public.portal_sponsor_opportunities(client_id,created_at desc);
create table if not exists public.portal_sponsor_requests (
 id uuid primary key default gen_random_uuid(), opportunity_id uuid not null references public.portal_sponsor_opportunities(id),
 placement_key text not null, brand text not null, email text not null,
 quote jsonb not null, status text not null default 'pending' check(status in ('pending','confirmed','declined','cancelled')),
 intake_key uuid not null unique, created_at timestamptz not null default now()
);
create index if not exists portal_sponsor_requests_opportunity on public.portal_sponsor_requests(opportunity_id);
create table if not exists public.portal_sponsor_events (
 id uuid primary key default gen_random_uuid(), client_id uuid not null references public.portal_clients(id),
 opportunity_id uuid, actor text not null, action text not null, created_at timestamptz not null default now()
);
-- All mutation paths serialize on the client row, including acceptance of the last slot.
create or replace function public.portal_sponsor_mutate(target_client uuid, actor text, is_staff boolean, payload jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare op public.portal_sponsor_opportunities; req public.portal_sponsor_requests; slot jsonb; result_id uuid; used integer; menu_version integer; action text:=payload->>'action';
begin
 perform 1 from portal_clients where id=target_client and active for update;
 if not found then raise exception 'Active creator not found'; end if;
 if action='defaults' then
  if not is_staff then raise exception 'Staff only'; end if;
  update portal_sponsor_defaults set placements=payload->'placements' where singleton;
 elsif action='menu' then
  select version into menu_version from portal_sponsor_menus where client_id=target_client;
  if coalesce(menu_version,0)<>(payload->>'version')::integer then raise exception 'Menu changed. Refresh before saving'; end if;
  insert into portal_sponsor_menus(client_id,placements) values(target_client,payload->'placements')
   on conflict(client_id) do update set placements=excluded.placements,version=portal_sponsor_menus.version+1;
 elsif action='create' then
  result_id:=(payload->>'id')::uuid;
  if exists(select 1 from portal_sponsor_opportunities where id=result_id and client_id=target_client) then return jsonb_build_object('id',result_id); end if;
  insert into portal_sponsor_opportunities(id,client_id,details,placements) values(result_id,target_client,payload->'details',payload->'placements');
 else
  select * into op from portal_sponsor_opportunities where id=(payload->>'id')::uuid and client_id=target_client for update;
  if not found then raise exception 'Opportunity not found'; end if;
  result_id:=op.id;
  if action in ('save','submit','approve','return','close','withdraw') and op.version<>(payload->>'version')::integer then raise exception 'Opportunity changed. Refresh before continuing'; end if;
  if action='save' then
   if op.status<>'draft' then raise exception 'Only drafts can be edited'; end if;
   update portal_sponsor_opportunities set details=payload->'details',placements=payload->'placements' where id=op.id;
  elsif action='submit' then
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
   if op.status<>'approved' or (op.details->>'deadline')::date < current_date then raise exception 'This opportunity is closed to requests'; end if;
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
    if req.status<>'pending' or op.status<>'approved' or (op.details->>'deadline')::date < current_date then raise exception 'Request cannot be accepted'; end if;
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
-- No direct creator or anonymous table access.
do $$ declare t text; begin
 foreach t in array array['portal_sponsor_menus','portal_sponsor_defaults','portal_sponsor_opportunities','portal_sponsor_requests','portal_sponsor_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
revoke all on function public.portal_sponsor_mutate(uuid,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.portal_sponsor_mutate(uuid,text,boolean,jsonb) to service_role;
commit;
