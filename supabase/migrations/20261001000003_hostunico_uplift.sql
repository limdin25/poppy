begin;
-- Research qualification only. This creates no sender, job or billing action.
alter table sa_listings add column if not exists hostunico_uplift_status text not null default 'pending'
  check (hostunico_uplift_status in ('eligible','excluded','pending'));
alter table wk_dialer_queue add column if not exists hostunico_uplift_hold boolean not null default false;

create or replace function wk_hostunico_rent_matches(p_source text,p_rent numeric)
returns boolean language plpgsql immutable set search_path=public as $$
declare parts text[]; advertised numeric;
begin
  parts:=regexp_match(regexp_replace(trim(p_source),'\s+','','g'),'^[£]?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(pw|pcm|perweek|permonth|aweek|amonth)$','i');
  if parts is null or p_rent is null or p_rent<=0 then return false; end if;
  advertised:=replace(parts[1],',','')::numeric;
  if parts[2] ~* '(pw|week)' then advertised:=round(advertised*52/12,2); end if;
  return advertised>0 and abs(advertised-p_rent)<=0.01;
end $$;

create or replace function wk_hostunico_uplift_state(p_state text,p_pitch jsonb,p_rent numeric,p_entire boolean,p_source text)
returns text language plpgsql immutable set search_path=public as $$
declare earnings numeric; rent numeric;
begin
  if not coalesce(p_entire,false) then return 'excluded'; end if;
  if not wk_hostunico_rent_matches(p_source,p_rent) then return 'pending'; end if;
  if p_state is distinct from 'ready' or coalesce(p_pitch->>'planning','false') <> 'false'
    or jsonb_typeof(p_pitch->'monthlyGbpPence') is distinct from 'number'
    or jsonb_typeof(p_pitch->'askingRentGbpPence') is distinct from 'number'
    or p_rent is null or p_rent<=0 then return 'pending'; end if;
  earnings := (p_pitch->>'monthlyGbpPence')::numeric;
  rent := (p_pitch->>'askingRentGbpPence')::numeric;
  if earnings<=0 or rent<=0 or earnings<>trunc(earnings) or rent<>trunc(rent)
    or earnings>9007199254740991 or rent>9007199254740991
    or round(p_rent*100)<>rent then return 'pending'; end if;
  return case when earnings*100 >= rent*130 then 'eligible' else 'excluded' end;
end $$;

create or replace function wk_hostunico_outreach_allowed(p_contact uuid,p_body text default '',p_listing uuid default null)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare link text[];
begin
  if not exists(select 1 from wk_contacts c where c.id=p_contact and c.desk='sa'
    and (c.custom_fields->>'lead_type'='hostunico_owner' or exists(select 1 from sa_listings l where l.wk_contact_id=c.id and l.source='spareroom')))
    then return true; end if;
  if not exists(select 1 from sa_listings l join sa_property_reports r on r.listing_id=l.id
    where l.wk_contact_id=p_contact and (p_listing is null or l.id=p_listing)
    and wk_hostunico_uplift_state(r.state,r.report_pitch,l.rent_pcm,l.hostunico_call_eligible,l.source_price)='eligible') then return false; end if;
  for link in select regexp_matches(coalesce(p_body,''),'https?://(?:www\.)?hostunico\.com/r/([A-Za-z0-9]{5})(?:[^A-Za-z0-9]|$)','g') loop
    if not exists(select 1 from sa_listings l join sa_property_reports r on r.listing_id=l.id
      where l.wk_contact_id=p_contact and r.report_url='https://hostunico.com/r/'||link[1]
      and wk_hostunico_uplift_state(r.state,r.report_pitch,l.rent_pcm,l.hostunico_call_eligible,l.source_price)='eligible') then return false; end if;
  end loop;
  return true;
end $$;
revoke all on function wk_hostunico_outreach_allowed(uuid,text,uuid) from public,anon,authenticated;
grant execute on function wk_hostunico_outreach_allowed(uuid,text,uuid) to service_role;

create or replace function wk_hostunico_refresh_uplift(p_listing uuid)
returns void language plpgsql security definer set search_path=public as $$
declare lead_id uuid; next_state text; old_state text; held_stage text;
begin
  select wk_contact_id into lead_id from sa_listings where id=p_listing and source='spareroom';
  if lead_id is null then return; end if;
  -- Serialise all property results belonging to the same contact.
  select custom_fields->>'hostunico_sales_status',custom_fields->>'hostunico_held_stage'
    into old_state,held_stage from wk_contacts where id=lead_id and desk='sa' for update;
  if not found then return; end if;
  update sa_listings l set hostunico_uplift_status=wk_hostunico_uplift_state(r.state,r.report_pitch,l.rent_pcm,l.hostunico_call_eligible,l.source_price)
    from (select x.id,pr.state,pr.report_pitch from sa_listings x left join sa_property_reports pr on pr.listing_id=x.id where x.wk_contact_id=lead_id and x.source='spareroom') r
    where l.id=r.id and l.hostunico_uplift_status is distinct from wk_hostunico_uplift_state(r.state,r.report_pitch,l.rent_pcm,l.hostunico_call_eligible,l.source_price);
  select case when bool_or(hostunico_uplift_status='eligible') then 'eligible'
    when bool_or(hostunico_uplift_status='pending') then 'pending' else 'excluded' end into next_state
    from sa_listings where wk_contact_id=lead_id and source='spareroom';
  if old_state is distinct from next_state then
    update wk_contacts set custom_fields=coalesce(custom_fields,'{}'::jsonb)||jsonb_build_object(
      'hostunico_sales_status',next_state,
      'hostunico_held_stage',coalesce(held_stage,pipeline_column_id::text),
      'hostunico_sales_reason',case when next_state='excluded' then 'No property meets the minimum 30% earnings uplift.' when next_state='pending' then 'Waiting for research to confirm at least 30% earnings uplift.' else 'At least one property meets the minimum 30% earnings uplift.' end),
      pipeline_column_id=case when next_state<>'eligible' then null
        when pipeline_column_id is null and exists(select 1 from wk_pipeline_columns where id::text=held_stage) then held_stage::uuid else pipeline_column_id end
      where id=lead_id;
  end if;
  if next_state<>'eligible' then
    update wk_dialer_queue set status='skipped',hostunico_uplift_hold=true
      where contact_id=lead_id and campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92' and status='pending';
    update sa_report_followups set cold_at=coalesce(cold_at,now()),reason='Removed from active sales: minimum 30% earnings uplift not established.',updated_at=now()
      where contact_id=lead_id and cold_at is null;
  else
    update wk_dialer_queue set status='pending',hostunico_uplift_hold=false
      where contact_id=lead_id and campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92' and status='skipped' and hostunico_uplift_hold;
  end if;
end $$;
revoke all on function wk_hostunico_refresh_uplift(uuid) from public,anon,authenticated;
grant execute on function wk_hostunico_refresh_uplift(uuid) to service_role;

create or replace function wk_hostunico_report_uplift_event() returns trigger language plpgsql security definer set search_path=public as $$
begin perform wk_hostunico_refresh_uplift(case when tg_op='DELETE' then old.listing_id else new.listing_id end); return null; end $$;
create trigger hostunico_report_uplift after insert or update of state,report_pitch or delete on sa_property_reports
  for each row execute function wk_hostunico_report_uplift_event();
create or replace function wk_hostunico_listing_uplift_event() returns trigger language plpgsql security definer set search_path=public as $$
begin perform wk_hostunico_refresh_uplift(new.id); return null; end $$;
create trigger hostunico_listing_uplift after insert or update of rent_pcm,source_price,hostunico_call_eligible,report_property on sa_listings
  for each row execute function wk_hostunico_listing_uplift_event();

create or replace function wk_hostunico_queue_uplift_event() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92' and new.status in ('pending','dialing')
    and not wk_hostunico_outreach_allowed(new.contact_id) then
    if new.status='dialing' then return null; end if;
    new.status:='skipped'; new.hostunico_uplift_hold:=true;
  end if;
  return new;
end $$;
create trigger hostunico_queue_uplift before insert or update of status on wk_dialer_queue
  for each row execute function wk_hostunico_queue_uplift_event();

-- Apply the same rule to existing leads. Keep recordings, messages and reports.
do $$ declare item record; begin
  for item in select distinct on(wk_contact_id) id from sa_listings where source='spareroom' and wk_contact_id is not null loop
    perform wk_hostunico_refresh_uplift(item.id);
  end loop;
end $$;
commit;
