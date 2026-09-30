-- Tracking only. No cron, job, SMS sender or calendar action is created.
alter table wk_contacts add column if not exists hostunico_country text check(hostunico_country ~ '^[A-Z]{2}$');
create table if not exists sa_followup_config (
  id boolean primary key default true check(id), config jsonb not null,
  updated_at timestamptz not null default now()
);
insert into sa_followup_config(id,config) values (true,'{"steps":[{"id":"step1","label":"Step 1","waitHours":24,"text":"Did the numbers match what you expected?","approved":true},{"id":"step2","label":"Step 2","waitHours":48,"text":"Would a quick walkthrough of onboarding help?","approved":false},{"id":"step3","label":"Step 3","waitHours":120,"text":"Shall I leave this with you for now?","approved":false}],"branches":[{"intent":"positive","target":"replied","label":"Call this lead"},{"intent":"neutral","target":"replied","label":"Needs a human look"},{"intent":"negative","target":"cold","label":"Not interested"}]}') on conflict do nothing;
create table if not exists sa_report_followups (
  contact_id uuid primary key references wk_contacts(id),
  report_sent_at timestamptz not null,
  sent_steps jsonb not null default '{}',
  replied_at timestamptz, reply_body text, reply_kind text,
  intent text check(intent in ('positive','negative','neutral')),
  reason text, confidence numeric check(confidence between 0 and 1),
  classification_pending boolean not null default false,
  overridden_at timestamptz, overridden_by uuid,
  cold_at timestamptz,
  send_state text not null default 'idle', send_step text, send_requested_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table sa_followup_config enable row level security;
alter table sa_report_followups enable row level security;
revoke all on sa_followup_config,sa_report_followups from anon,authenticated;
grant select on sa_followup_config,sa_report_followups to authenticated;
grant all on sa_followup_config,sa_report_followups to service_role;
create policy sa_config_read on sa_followup_config for select to authenticated using (wk_is_agent_or_admin());
create policy sa_followups_read on sa_report_followups for select to authenticated using (
  wk_is_agent_or_admin() and exists(select 1 from wk_contacts c where c.id=contact_id and c.desk='sa' and (c.owner_agent_id=auth.uid() or wk_is_admin()))
);
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='sa_report_followups') then
    alter publication supabase_realtime add table sa_report_followups;
  end if;
end $$;

create or replace function sa_record_report_reply(p_contact uuid,p_at timestamptz,p_body text,p_kind text)
returns void language plpgsql security definer set search_path=public as $$
declare stop_requested boolean;
begin
  stop_requested := trim(p_body) ~* '^(stop|stopall|unsubscribe|quit|cancel|end)[.! ]*$'
    or p_body ~* '(stop|quit)[ ]+(messaging|texting|contacting|calling|sending)'
    or p_body ~* '(do not|don''t|dont)[ ]+(text|call|contact|message)'
    or p_body ~* 'remove[ ]+(me|my number)';
  update sa_report_followups set replied_at=p_at,reply_body=left(p_body,4000),reply_kind=p_kind,
    intent=case when stop_requested then 'negative' else 'neutral' end,
    reason=case when stop_requested then 'The lead asked us to stop contacting them.' else 'Needs a human look. Classification pending.' end,
    confidence=case when stop_requested then 1 else 0 end,
    classification_pending=not stop_requested and p_kind='sms',overridden_at=null,overridden_by=null,
    cold_at=case when stop_requested then p_at else null end,updated_at=now()
  where contact_id=p_contact and p_at>=report_sent_at and (replied_at is null or p_at>replied_at);
  if found and stop_requested then
    update wk_contacts set do_not_call=true where id=p_contact and desk='sa';
    insert into wk_contact_tags(contact_id,tag) values(p_contact,'do-not-text') on conflict do nothing;
  end if;
end $$;
revoke all on function sa_record_report_reply(uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function sa_record_report_reply(uuid,timestamptz,text,text) to service_role;

create or replace function sa_followup_message_event() returns trigger language plpgsql security definer set search_path=public as $$
declare report_match boolean;
begin
  if new.contact_id is null or coalesce(new.status,'') in ('draft','discarded','failed','undelivered') then return new; end if;
  if new.direction='inbound' then
    perform sa_record_report_reply(new.contact_id,new.created_at,coalesce(new.body,''),coalesce(new.channel,'sms'));
  elsif new.direction='outbound' then
    select exists(select 1 from sa_property_reports r join sa_listings l on l.id=r.listing_id
      join wk_contacts c on c.id=l.wk_contact_id
      where c.id=new.contact_id and c.desk='sa' and r.report_url is not null and position(r.report_url in new.body)>0) into report_match;
    if report_match then
      insert into sa_report_followups(contact_id,report_sent_at) values(new.contact_id,new.created_at) on conflict do nothing;
    end if;
  end if;
  return new;
end $$;
create trigger sa_followup_message_event after insert or update of status on wk_sms_messages
  for each row execute function sa_followup_message_event();

create or replace function sa_followup_call_event() returns trigger language plpgsql security definer set search_path=public as $$
declare lead_id uuid;
begin
  if new.direction='inbound' or (new.direction='outbound' and new.answered_at is not null and coalesce(new.duration_sec,0)>=20) then
    select id into lead_id from wk_contacts where desk='sa' and (id=new.contact_id or (new.direction='inbound' and phone=new.from_e164)) limit 1;
    if lead_id is not null then perform sa_record_report_reply(lead_id,coalesce(new.started_at,new.created_at),'Call logged. Pedro should review the conversation.','call'); end if;
  end if;
  return new;
end $$;
create trigger sa_followup_call_event after insert or update of answered_at,duration_sec,contact_id on wk_calls
  for each row execute function sa_followup_call_event();

-- The row lock arbitrates a manual send against a reply. A reply already recorded wins.
create or replace function sa_claim_followup(p_contact uuid,p_step text)
returns boolean language plpgsql security definer set search_path=public as $$
declare lead sa_report_followups; item jsonb; anchor timestamptz; cfg jsonb;
begin
  select * into lead from sa_report_followups where contact_id=p_contact for update;
  if not found or lead.replied_at is not null or lead.cold_at is not null or lead.send_state<>'idle' then return false; end if;
  if exists(select 1 from wk_contacts where id=p_contact and do_not_call) or exists(select 1 from wk_contact_tags where contact_id=p_contact and tag='do-not-text') then return false; end if;
  select config into cfg from sa_followup_config where id=true;
  anchor:=lead.report_sent_at;
  for item in select * from jsonb_array_elements(cfg->'steps') loop
    if lead.sent_steps ? (item->>'id') then anchor:=(lead.sent_steps->>(item->>'id'))::timestamptz;
    else
      if item->>'id'<>p_step or not (item->>'approved')::boolean or now()<anchor+make_interval(secs=>(item->>'waitHours')::numeric*3600) then return false; end if;
      update sa_report_followups set send_state='sending',send_step=p_step,send_requested_at=now(),updated_at=now() where contact_id=p_contact;
      return true;
    end if;
  end loop;
  return false;
end $$;
revoke all on function sa_claim_followup(uuid,text) from public,anon,authenticated;
grant execute on function sa_claim_followup(uuid,text) to service_role;

insert into wk_pipeline_columns(pipeline_id,name,colour,position,sort_order,is_terminal)
select 'dadce4ac-90b5-4320-9291-ff6bb1cf89f0','Cold','#94A3B8',10,10,true
where not exists(select 1 from wk_pipeline_columns where pipeline_id='dadce4ac-90b5-4320-9291-ff6bb1cf89f0' and name='Cold');
create or replace function sa_followup_cold_contact() returns trigger language plpgsql security definer set search_path=public as $$
declare stage_id uuid;
begin
  if new.cold_at is not null and (tg_op='INSERT' or old.cold_at is null) then
    select id into stage_id from wk_pipeline_columns where pipeline_id='dadce4ac-90b5-4320-9291-ff6bb1cf89f0' and name=case when new.intent='negative' then 'Not interested' else 'Cold' end limit 1;
    update wk_contacts set pipeline_column_id=coalesce(stage_id,pipeline_column_id) where id=new.contact_id and desk='sa';
    update wk_dialer_queue set status='skipped' where contact_id=new.contact_id and campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92' and status='pending';
  end if;
  return new;
end $$;
create trigger sa_followup_cold_contact after insert or update of cold_at on sa_report_followups for each row execute function sa_followup_cold_contact();
