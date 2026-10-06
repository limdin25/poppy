-- Only plans explicitly reviewed with Send report are armed. No legacy backfill.
alter table public.sa_property_reports add column if not exists email_state text not null default 'unsent';
alter table public.sa_property_reports add column if not exists email_id text;
alter table public.sa_report_followups add column if not exists stopped_at timestamptz;
alter table public.sa_report_followups add column if not exists stop_reason text;

create table public.sa_report_followup_items (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.wk_contacts(id),
  listing_id uuid not null references public.sa_listings(id),
  step_key text not null check (step_key ~ '^step[0-9]+$'),
  channel text not null check (channel in ('sms','email')),
  recipient text not null,
  subject text not null default '', body text not null,
  scheduled_for timestamptz not null,
  timezone text not null default 'Europe/London' check (timezone='Europe/London'),
  status text not null default 'scheduled' check (status in ('scheduled','edited','skipped','sent','cancelled','sending','check_inbox')),
  armed_at timestamptz, send_requested_at timestamptz, sent_at timestamptz,
  provider_id text, message_id uuid, cancel_reason text,
  agent_id uuid not null, version integer not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(contact_id,step_key),
  check (length(body) between 1 and 10000),
  check ((scheduled_for at time zone 'Europe/London')::time >= time '09:00' and (scheduled_for at time zone 'Europe/London')::time < time '20:00')
);
create index sa_report_followup_due on public.sa_report_followup_items(scheduled_for) where status in ('scheduled','edited') and armed_at is not null;
alter table public.sa_report_followup_items enable row level security;
revoke all on public.sa_report_followup_items from anon,authenticated;
grant select on public.sa_report_followup_items to authenticated;
grant all on public.sa_report_followup_items to service_role;
create policy sa_report_items_read on public.sa_report_followup_items for select to authenticated using (
  wk_is_agent_or_admin() and exists(select 1 from public.wk_contacts c where c.id=contact_id and c.desk='sa' and (c.owner_agent_id=auth.uid() or wk_is_admin()))
);
alter publication supabase_realtime add table public.sa_report_followup_items;

create function public.sa_followup_now() returns timestamptz language sql volatile as $$ select clock_timestamp() $$;

create function public.sa_report_followup_stop_reason(p_contact uuid) returns text
language sql stable security definer set search_path=public as $$
  select case
    when c.desk <> 'sa' then 'Contact moved to another desk'
    when c.do_not_call then 'Do not contact'
    when f.stopped_at is not null then coalesce(f.stop_reason,'Sequence stopped')
    when s.name in ('Not interested','Do not contact','Onboarded','Review call booked','Preparing to onboard') then s.name
    when exists(select 1 from wk_contact_tags where contact_id=c.id and tag in ('do-not-text','not-interested')) then 'Contact opted out'
    when exists(select 1 from sa_report_followups where contact_id=c.id and replied_at is not null) then 'Lead replied'
    when exists(select 1 from sa_report_followups where contact_id=c.id and cold_at is not null) then 'Sequence stopped'
    when exists(select 1 from wk_contact_followups where contact_id=c.id and (status in ('pending','snoozed') or created_at>=f.report_sent_at)) then 'Call follow-up booked'
    else null end
  from wk_contacts c left join wk_pipeline_columns s on s.id=c.pipeline_column_id left join sa_report_followups f on f.contact_id=c.id where c.id=p_contact
$$;

create function public.sa_cancel_report_followups(p_contact uuid,p_reason text default 'Cancelled by Pedro') returns integer
language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  update sa_report_followup_items set status='cancelled',cancel_reason=p_reason,version=version+1,updated_at=now()
  where contact_id=p_contact and status in ('scheduled','edited','skipped','sending');
  get diagnostics n=row_count;
  update sa_report_followups set stopped_at=coalesce(stopped_at,now()),stop_reason=coalesce(stop_reason,p_reason) where contact_id=p_contact;
  return n;
end $$;

create function public.sa_save_report_followup_plan(p_contact uuid,p_listing uuid,p_channel text,p_recipient text,p_items jsonb,p_agent uuid) returns void
language plpgsql security definer set search_path=public as $$
declare item jsonb; previous sa_report_followup_items; at_time timestamptz; reason text; next_status text; c wk_contacts;
begin
  select * into c from wk_contacts where id=p_contact for update;
  if not found or c.desk<>'sa' or not exists(select 1 from sa_listings where id=p_listing and wk_contact_id=p_contact) then raise exception 'Property does not belong to this contact'; end if;
  if p_channel not in ('sms','email') or nullif(trim(p_recipient),'') is null or p_agent is null then raise exception 'Choose a recipient and channel'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 8 then raise exception 'Refresh the follow-up plan'; end if;
  if (select count(distinct i->>'step_key') from jsonb_array_elements(p_items)i)<>jsonb_array_length(p_items) then raise exception 'Duplicate follow-up step'; end if;
  reason:=sa_report_followup_stop_reason(p_contact);
  if exists(select 1 from sa_report_followups where contact_id=p_contact and send_state<>'idle') then raise exception 'Check the previous manual send in the inbox before scheduling'; end if;
  insert into sa_report_followups(contact_id,report_sent_at) values(p_contact,now()) on conflict do nothing;
  for item in select * from jsonb_array_elements(p_items) loop
    select * into previous from sa_report_followup_items where contact_id=p_contact and step_key=item->>'step_key' for update;
    if found and previous.status not in ('scheduled','edited','skipped') then continue; end if;
    if coalesce((item->>'version')::integer,-1)<>coalesce(previous.version,0) then raise exception 'The follow-up changed. Refresh before saving'; end if;
    if item->>'channel' is distinct from coalesce(previous.channel,p_channel) then raise exception 'The channel changed. Refresh before saving'; end if;
    if item->>'step_key' !~ '^step[0-9]+$' or jsonb_typeof(item->'enabled')<>'boolean' then raise exception 'Invalid follow-up'; end if;
    if not exists(select 1 from sa_followup_config,jsonb_array_elements(config->'steps') s where s->>'id'=item->>'step_key') and previous.id is null then raise exception 'Unknown follow-up step'; end if;
    at_time:=(item->>'scheduled_for')::timestamptz;
    if at_time is null or (at_time at time zone 'Europe/London')::time < time '09:00' or (at_time at time zone 'Europe/London')::time >= time '20:00' then raise exception 'Choose a time between 09:00 and 20:00 London'; end if;
    if (item->>'enabled')::boolean then
      if reason is not null then raise exception 'Follow-ups stopped: %',reason; end if;
      if at_time<=sa_followup_now() then raise exception 'Choose a future follow-up time'; end if;
      if nullif(trim(item->>'body'),'') is null or length(item->>'body')>(case when item->>'channel'='sms' then 1600 else 10000 end) then raise exception 'Check the message length'; end if;
      if item->>'channel'='email' and (nullif(trim(item->>'subject'),'') is null or length(item->>'subject')>200) then raise exception 'Add an email subject'; end if;
    end if;
    next_status:=case when not (item->>'enabled')::boolean then 'skipped'
      when previous.id is null then 'scheduled'
      when previous.body is distinct from item->>'body' or previous.subject is distinct from coalesce(item->>'subject','') or previous.scheduled_for is distinct from at_time or previous.status='skipped' then 'edited'
      else previous.status end;
    if previous.id is null and exists(select 1 from sa_report_followups where contact_id=p_contact and sent_steps ? (item->>'step_key')) then next_status:='sent'; end if;
    insert into sa_report_followup_items(contact_id,listing_id,step_key,channel,recipient,subject,body,scheduled_for,status,agent_id,sent_at)
    values(p_contact,p_listing,item->>'step_key',p_channel,p_recipient,coalesce(item->>'subject',''),item->>'body',at_time,next_status,p_agent,
      case when next_status='sent' then (select (sent_steps->>(item->>'step_key'))::timestamptz from sa_report_followups where contact_id=p_contact) else null end)
    on conflict(contact_id,step_key) do update set subject=excluded.subject,body=excluded.body,scheduled_for=excluded.scheduled_for,status=excluded.status,version=sa_report_followup_items.version+1,updated_at=now();
  end loop;
end $$;

create function public.sa_arm_report_followups(p_contact uuid,p_listing uuid) returns void
language plpgsql security definer set search_path=public as $$
declare reason text;
begin
  perform 1 from wk_contacts where id=p_contact for update;
  if not exists(select 1 from sa_property_reports where listing_id=p_listing and (sms_sid is not null or email_id is not null)) then raise exception 'Report submission is not confirmed'; end if;
  reason:=sa_report_followup_stop_reason(p_contact);
  if reason is not null then perform sa_cancel_report_followups(p_contact,reason); return; end if;
  update sa_report_followup_items set armed_at=now(),updated_at=now()
    where contact_id=p_contact and listing_id=p_listing and armed_at is null and status in ('scheduled','edited','skipped');
end $$;

create function public.sa_claim_report_followup(p_item uuid,p_version integer) returns boolean
language plpgsql security definer set search_path=public as $$
declare item sa_report_followup_items; reason text; local_time time;
begin
  -- Same lock order as saving/stage changes: contact first, then item.
  perform 1 from wk_contacts where id=(select contact_id from sa_report_followup_items where id=p_item) for update;
  select * into item from sa_report_followup_items where id=p_item for update;
  if not found or item.version<>p_version or item.status not in ('scheduled','edited') or item.armed_at is null or item.scheduled_for>sa_followup_now() then return false; end if;
  reason:=sa_report_followup_stop_reason(item.contact_id);
  if reason is not null then perform sa_cancel_report_followups(item.contact_id,reason); return false; end if;
  local_time:=(sa_followup_now() at time zone 'Europe/London')::time;
  if local_time<time '09:00' or local_time>=time '20:00' then return false; end if;
  update sa_report_followup_items set status='sending',send_requested_at=now(),updated_at=now() where id=p_item;
  return true;
end $$;

create function public.sa_stop_report_followups_event() returns trigger language plpgsql security definer set search_path=public as $$
declare contact uuid; reason text;
begin
  if tg_table_name='wk_contacts' then contact:=new.id; else contact:=new.contact_id; end if;
  reason:=sa_report_followup_stop_reason(contact);
  if reason is not null then perform sa_cancel_report_followups(contact,reason); end if;
  return new;
end $$;
create trigger sa_stop_report_on_stage after update of pipeline_column_id,do_not_call,desk on wk_contacts for each row execute function sa_stop_report_followups_event();
create trigger sa_stop_report_on_reply after insert or update of replied_at,cold_at on sa_report_followups for each row execute function sa_stop_report_followups_event();
create trigger sa_stop_report_on_booking after insert or update of status,due_at on wk_contact_followups for each row execute function sa_stop_report_followups_event();
create trigger sa_stop_report_on_optout after insert on wk_contact_tags for each row execute function sa_stop_report_followups_event();

-- Legacy manual sender must not duplicate a reviewed automatic plan.
alter function public.sa_claim_followup(uuid,text) rename to sa_claim_legacy_followup;
create function public.sa_claim_followup(p_contact uuid,p_step text) returns boolean
language plpgsql security definer set search_path=public as $$
begin
  perform 1 from wk_contacts where id=p_contact for update;
  if exists(select 1 from sa_report_followup_items where contact_id=p_contact) or sa_report_followup_stop_reason(p_contact) is not null then return false; end if;
  if (sa_followup_now() at time zone 'Europe/London')::time not between time '09:00' and time '19:59:59' then return false; end if;
  return sa_claim_legacy_followup(p_contact,p_step);
end $$;
revoke all on function public.sa_claim_legacy_followup(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.sa_followup_now(),public.sa_report_followup_stop_reason(uuid),public.sa_cancel_report_followups(uuid,text),public.sa_save_report_followup_plan(uuid,uuid,text,text,jsonb,uuid),public.sa_arm_report_followups(uuid,uuid),public.sa_claim_report_followup(uuid,integer),public.sa_stop_report_followups_event(),public.sa_claim_followup(uuid,text) from public,anon,authenticated;
grant execute on function public.sa_report_followup_stop_reason(uuid),public.sa_cancel_report_followups(uuid,text),public.sa_save_report_followup_plan(uuid,uuid,text,text,jsonb,uuid),public.sa_arm_report_followups(uuid,uuid),public.sa_claim_report_followup(uuid,integer),public.sa_claim_followup(uuid,text) to service_role;
