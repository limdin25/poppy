-- Hugo, 14 Oct 06:22: Pedro calls SpareRoom leads only. The morning deal and
-- counts read the listing sources from platform_settings.hostunico_morning_leads
-- "sources" (default both). Set to ["spareroom"]. Undo: remove the key.
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
      and l.source in (select jsonb_array_elements_text(coalesce((select value::jsonb->'sources' from platform_settings where key='hostunico_morning_leads'),'["spareroom","rightmove"]'::jsonb))) and not wk_hostunico_listing_in_london(l.city,l.outcode)
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
      and l.source in (select jsonb_array_elements_text(coalesce((select value::jsonb->'sources' from platform_settings where key='hostunico_morning_leads'),'["spareroom","rightmove"]'::jsonb))) and not wk_hostunico_listing_in_london(l.city,l.outcode)
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

update public.platform_settings set value=(value::jsonb||'{"sources":["spareroom"]}'::jsonb)::text, updated_at=now(), updated_by='migration 20261014000004'
where key='hostunico_morning_leads';
