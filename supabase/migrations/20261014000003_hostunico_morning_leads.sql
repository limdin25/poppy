-- Nightly morning leads for Pedro (Hugo, 2026-10-14). No call, text or email is
-- ever sent by any of this. The VPS scrapes and imports SpareRoom at 05:30
-- London (Mon to Sat); /api/cron/hostunico-morning-leads then tops the queue
-- up, prepares every missing report and writes one summary row a day.
begin;
set local lock_timeout = '15s';

-- One row per morning. Hugo's assistant reads it; level 'warn' means stock is
-- under two days of calling, 'blocked' means the SpareRoom session needs Hugo.
create table if not exists public.hostunico_morning_runs (
  run_date date primary key,
  level text not null default 'info' check (level in ('info','warn','blocked')),
  ready_before int,
  ready_after int,
  added_contacts int not null default 0,
  added_listings int not null default 0,
  reports_started int not null default 0,
  reports_ready int not null default 0,
  failures int not null default 0,
  stock_left int,
  passes int not null default 0,
  note text,
  vps jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.hostunico_morning_runs enable row level security;
revoke all on public.hostunico_morning_runs from anon, authenticated;
grant select on public.hostunico_morning_runs to authenticated;
drop policy if exists hostunico_morning_runs_admin_read on public.hostunico_morning_runs;
create policy hostunico_morning_runs_admin_read on public.hostunico_morning_runs for select to authenticated using (wk_is_admin());

-- Every number is a setting: cities and their SpareRoom searches (the 1 Oct
-- city list, studio/1-bed and 2/3-bed searches), nightly caps and the target.
insert into public.platform_settings(key, value, updated_at, updated_by)
values ('hostunico_morning_leads', $json${"enabled": true, "target_ready": 150, "max_new_listings": 150, "max_reports": 200, "daily_leads": 100, "sizes": ["studio", "1", "2", "3"], "cities": [{"name": "Leeds", "searches": ["1494390998", "1495749127"]}, {"name": "Manchester", "searches": ["1494391976", "1495748542"]}, {"name": "Liverpool", "searches": ["1494391979", "1495749133"]}, {"name": "Birmingham", "searches": ["1494391981", "1495749136"]}, {"name": "Sheffield", "searches": ["1494391984", "1495749139"]}, {"name": "Nottingham", "searches": ["1494391989", "1495749147"]}, {"name": "Leicester", "searches": ["1494391992", "1495749149"]}, {"name": "Bristol", "searches": ["1494391995", "1495749152"]}, {"name": "Newcastle", "searches": ["1494391999", "1495749154"]}, {"name": "Cardiff", "searches": ["1494392001", "1495749156"]}, {"name": "Southampton", "searches": ["1494392002", "1495749159"]}, {"name": "Hull", "searches": ["1494425509", "1495749160"]}, {"name": "Norwich", "searches": ["1494425511", "1495749166"]}, {"name": "Plymouth", "searches": ["1494425515", "1495749169"]}, {"name": "Bournemouth", "searches": ["1494425517", "1495749172"]}, {"name": "Brighton", "searches": ["1494425521", "1495749175"]}, {"name": "York", "searches": ["1494425523", "1495749177"]}, {"name": "Swansea", "searches": ["1494425524", "1495749181"]}, {"name": "Glasgow", "searches": ["1494464425", "1495749183"]}, {"name": "Edinburgh", "searches": ["1494464427", "1495749187"]}, {"name": "Aberdeen", "searches": ["1494464428", "1495749190"]}, {"name": "Dundee", "searches": ["1494464430", "1495749193"]}, {"name": "Cambridge", "searches": ["1494464431", "1495749196"]}, {"name": "Oxford", "searches": ["1494464434", "1495749197"]}, {"name": "Exeter", "searches": ["1494469163", "1495749201"]}, {"name": "Ipswich", "searches": ["1494469166", "1495749206"]}, {"name": "Blackpool", "searches": ["1494469169", "1495749213"]}, {"name": "Belfast", "searches": ["1494469175", "1495749215"]}, {"name": "Reading", "searches": ["1494469176", "1495749222"]}, {"name": "Milton Keynes", "searches": ["1494469178", "1495749226"]}, {"name": "Middlesbrough", "searches": ["1494477204", "1495749228"]}, {"name": "Lincoln", "searches": ["1494477205", "1495749232"]}, {"name": "Stoke-on-Trent", "searches": ["1494477200", "1495749234"]}, {"name": "Swindon", "searches": ["1494477202", "1495749239"]}, {"name": "Truro", "searches": ["1494551303", "1495749242"]}, {"name": "Taunton", "searches": ["1494551306", "1495749244"]}, {"name": "Torquay", "searches": ["1494551308", "1495749246"]}, {"name": "Carlisle", "searches": ["1494551311", "1495749247"]}, {"name": "Lancaster", "searches": ["1494551314", "1495749252"]}, {"name": "Hereford", "searches": ["1494551315", "1495749253"]}, {"name": "Shrewsbury", "searches": ["1494551316", "1495749255"]}, {"name": "Cheltenham", "searches": ["1494551328", "1495749258"]}, {"name": "Portsmouth", "searches": ["1494551334", "1495749261"]}, {"name": "Bedford", "searches": ["1494551346", "1495749264"]}, {"name": "Wrexham", "searches": ["1494551351", "1495749267"]}, {"name": "Aberystwyth", "searches": ["1494551355", "1495749271"]}, {"name": "Inverness", "searches": ["1494551356", "1495749275"]}, {"name": "Stirling", "searches": ["1494551357", "1495749281"]}, {"name": "Dumfries", "searches": ["1494551363", "1495749285"]}, {"name": "Canterbury", "searches": ["1494566540", "1495749288"]}, {"name": "Colchester", "searches": ["1494566547", "1495749290"]}, {"name": "Peterborough", "searches": ["1494566551", "1495749292"]}, {"name": "Northampton", "searches": ["1494566553", "1495749293"]}, {"name": "Perth", "searches": ["1494566559", "1495749296"]}, {"name": "Bath", "searches": ["1494566564", "1495749300"]}, {"name": "Worcester", "searches": ["1494566568", "1495749302"]}, {"name": "Gloucester", "searches": ["1494566570", "1495749305"]}, {"name": "Chester", "searches": ["1494566572", "1495749309"]}, {"name": "Luton", "searches": ["1494570938", "1495749313"]}, {"name": "Watford", "searches": ["1494570949", "1495749315"]}, {"name": "Stevenage", "searches": ["1494570951", "1495749316"]}, {"name": "Chelmsford", "searches": ["1494570956", "1495749322"]}, {"name": "Basildon", "searches": ["1494570960", "1495749323"]}, {"name": "Southend-on-Sea", "searches": ["1494570970", "1495749324"]}]}$json$, now(), 'migration 20261014000003')
on conflict (key) do nothing;

create or replace function public.wk_hostunico_listing_in_london(p_city text, p_outcode text)
returns boolean language sql immutable set search_path=public as $$
  select lower(coalesce(p_city,'')) = 'london' or coalesce(substring(upper(p_outcode) from '^[A-Z]+'),'') in ('E','EC','N','NW','SE','SW','W','WC')
$$;

-- A contact Pedro can call right now with a ready, qualifying report.
create or replace function public.wk_hostunico_contact_ready(p_contact uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from sa_listings l join sa_property_reports r on r.listing_id=l.id
    where l.wk_contact_id=p_contact and l.hostunico_uplift_status='eligible' and r.state='ready'
      and r.report_url ~ '^https://hostunico\.com/r/[A-Za-z0-9]{5}$')
$$;

create or replace function public.wk_hostunico_morning_counts()
returns jsonb language sql stable security definer set search_path=public as $$
  with q as (
    select q.contact_id, q.status, q.hostunico_uplift_hold hold
    from wk_dialer_queue q join wk_contacts c on c.id=q.contact_id
    where q.campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92' and c.desk='sa' and not c.do_not_call)
  select jsonb_build_object(
    'ready', (select count(distinct contact_id) from q where status='pending' and wk_contact_dialer_servable(contact_id) and wk_hostunico_contact_ready(contact_id)),
    'pending_without_report', (select count(distinct contact_id) from q where status='pending' and not wk_hostunico_contact_ready(contact_id)),
    'held_waiting_report', (select count(distinct q.contact_id) from q where q.status='skipped' and q.hold
      and exists(select 1 from sa_listings l where l.wk_contact_id=q.contact_id and l.hostunico_call_eligible and l.hostunico_uplift_status='pending')),
    'undealt_listings', (select count(*) from sa_listings l where l.hostunico_call_eligible and l.report_property is not null
      and l.source in ('spareroom','rightmove') and not wk_hostunico_listing_in_london(l.city,l.outcode)
      and (l.wk_contact_id is null or not exists(select 1 from wk_dialer_queue x where x.contact_id=l.wk_contact_id and x.campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92'))))
$$;

-- Deals eligible listings that are not yet on Pedro's queue. Listings with no
-- contact are grouped by normalised phone and enter only through the strict
-- door (wk_admit_new_contact), so a known number is never added. Agencies
-- marked Not interested in the last 30 days are skipped. Every new queue row
-- starts held: it is released only when its report qualifies.
create or replace function public.wk_hostunico_morning_deal(p_limit int)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; v_contact uuid; v_owner uuid; v_stage uuid; v_contacts int := 0; v_listings int := 0; v_skipped int := 0; v_n int;
begin
  if coalesce(auth.role(),'')<>'service_role' and not coalesce(wk_is_admin(),false) then raise exception 'forbidden'; end if;
  select id into v_owner from profiles where email='pedro@hostunico.com';
  select id into v_stage from wk_pipeline_columns where pipeline_id='dadce4ac-90b5-4320-9291-ff6bb1cf89f0' and name='New lead';
  if v_owner is null or v_stage is null then raise exception 'Hostunico owner or stage missing'; end if;
  for r in
    select wk_normalize_phone(l.agency_phone) phone, l.wk_contact_id contact_id, min(l.agency) agency,
           array_agg(l.id order by l.created_at) ids, max(l.created_at) newest
    from sa_listings l
    where l.hostunico_call_eligible and l.report_property is not null and coalesce(array_length(l.photo_urls,1),0)>0
      and l.source in ('spareroom','rightmove') and not wk_hostunico_listing_in_london(l.city,l.outcode)
      and (l.wk_contact_id is null or not exists(select 1 from wk_dialer_queue x where x.contact_id=l.wk_contact_id and x.campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92'))
    group by 1,2 order by max(l.created_at) desc
  loop
    exit when v_listings >= p_limit;
    if r.phone is null then v_skipped := v_skipped + 1; continue; end if;
    if exists(select 1 from wk_contacts c join wk_pipeline_columns p on p.id=c.pipeline_column_id
              join sa_listings l2 on l2.wk_contact_id=c.id
              where p.name='Not interested' and c.stage_moved_at > now()-interval '30 days'
                and lower(trim(l2.agency))=lower(trim(r.agency))) then
      v_skipped := v_skipped + 1; continue;
    end if;
    v_contact := r.contact_id;
    if v_contact is null then
      v_contact := wk_admit_new_contact(jsonb_build_object('name',r.agency,'phone',r.phone,'desk','sa','owner_agent_id',v_owner,
        'pipeline_column_id',v_stage,'ai_enabled',false,'custom_fields',jsonb_build_object('lead_type','hostunico_owner','source','morning_leads','next_step','Offer the property report')));
      if v_contact is null then v_skipped := v_skipped + 1; continue; end if;
      update sa_listings set wk_contact_id=v_contact where id = any(r.ids) and wk_contact_id is null;
      v_contacts := v_contacts + 1;
    else
      -- An existing contact is dealt only if it is Pedro's, on this desk,
      -- reachable and has never been called.
      if not exists(select 1 from wk_contacts c where c.id=v_contact and c.desk='sa' and c.owner_agent_id=v_owner and not c.do_not_call)
         or exists(select 1 from wk_calls k where k.contact_id=v_contact) then
        v_skipped := v_skipped + 1; continue;
      end if;
      update wk_contacts set custom_fields=coalesce(custom_fields,'{}'::jsonb)||'{"lead_type":"hostunico_owner"}'::jsonb,
        pipeline_column_id=coalesce(pipeline_column_id,v_stage) where id=v_contact;
    end if;
    insert into wk_dialer_queue(campaign_id,contact_id,status,hostunico_uplift_hold,priority)
    values('5d9657f9-d9b4-4e27-a2d1-83db80867f92',v_contact,'skipped',true,100);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_listings := v_listings + coalesce(array_length(r.ids,1),0); end if;
  end loop;
  return jsonb_build_object('contacts',v_contacts,'listings',v_listings,'skipped',v_skipped);
end $$;

revoke all on function public.wk_hostunico_morning_counts(), public.wk_hostunico_morning_deal(int), public.wk_hostunico_contact_ready(uuid) from public, anon, authenticated;
grant execute on function public.wk_hostunico_morning_counts(), public.wk_hostunico_morning_deal(int), public.wk_hostunico_contact_ready(uuid) to service_role;

-- Hugo, 14 Oct 04:42: move the pending Rightmove leads from the inactive
-- "SA - Pedro" campaign into "Hostunico - Pedro". The same queue row moves
-- (no duplicate, attempts and history kept) and is held until its report
-- qualifies. London stays out, as on every Hostunico import.
create temporary table hostunico_moved on commit drop as
  select q.id queue_id, c.id contact_id
  from wk_dialer_queue q join wk_contacts c on c.id=q.contact_id
  where q.campaign_id='ba59aee7-8461-4d81-a305-ed3405fc96a6' and q.status='pending' and c.desk='sa' and not c.do_not_call
    and not exists(select 1 from wk_dialer_queue h where h.contact_id=c.id and h.campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92')
    and exists(select 1 from sa_listings l where l.wk_contact_id=c.id and l.source='rightmove' and not wk_hostunico_listing_in_london(l.city,l.outcode)
      and l.rent_pcm>0 and l.bedrooms between 1 and 7 and l.outcode ~ '^[A-Z]{1,2}[0-9][A-Z0-9]?$' and coalesce(array_length(l.photo_urls,1),0)>0);

update wk_contacts c set
  custom_fields=coalesce(c.custom_fields,'{}'::jsonb)||jsonb_build_object('lead_type','hostunico_owner','advertiser_type','letting agent','next_step','Offer the whole-property earnings report','moved_from_campaign','SA - Pedro'),
  pipeline_column_id=(select id from wk_pipeline_columns where pipeline_id='dadce4ac-90b5-4320-9291-ff6bb1cf89f0' and name='New lead')
from hostunico_moved m where c.id=m.contact_id;

update wk_dialer_queue q set campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92', status='skipped', hostunico_uplift_hold=true
from hostunico_moved m where q.id=m.queue_id;

update sa_listings l set
  photo_urls=array(select replace(u,'https://media.rightmove.co.uk:443/','https://media.rightmove.co.uk/') from unnest(l.photo_urls) u),
  source_price=coalesce(l.source_price,'£'||case when l.rent_pcm=trunc(l.rent_pcm) then to_char(l.rent_pcm,'FM999999990') else to_char(l.rent_pcm,'FM999999990.00') end||' pcm'),
  report_property=jsonb_build_object('postcode',l.outcode,'areaLabel',coalesce(l.city,l.outcode),'bedrooms',l.bedrooms,
    'bathrooms',case when l.bathrooms between 1 and 12 then l.bathrooms else 1 end,'wholeProperty',true,'areaEstimate',true,'advertisedRentPcm',l.rent_pcm),
  hostunico_call_eligible=true,
  hostunico_eligibility_note='Whole property let on Rightmove, asking rent and photo from the advert. Moved from SA - Pedro on 14 Oct 2026.'
from hostunico_moved m where l.wk_contact_id=m.contact_id and l.source='rightmove' and not wk_hostunico_listing_in_london(l.city,l.outcode);

notify pgrst,'reload schema';
commit;
