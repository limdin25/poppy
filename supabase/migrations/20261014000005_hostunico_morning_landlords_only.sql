-- Hugo, 14 Oct 16:50: Pedro's queue is private landlords only, no agencies.
-- SpareRoom advertiser type (wk_contacts.custom_fields.advertiser_type = 'agent')
-- marks agencies. Setting hostunico_morning_leads.landlords_only (undo: set false).
CREATE OR REPLACE FUNCTION public.wk_hostunico_morning_deal(p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    -- Hugo, 14 Oct 16:50: landlords only. Skip SpareRoom agency advertisers.
    if coalesce((select value::jsonb->>'landlords_only' from platform_settings where key='hostunico_morning_leads'),'false')='true'
       and (exists(select 1 from wk_contacts c where (c.id=r.contact_id or c.normalized_phone=r.phone) and lower(coalesce(c.custom_fields->>'advertiser_type',''))='agent')
            or exists(select 1 from sa_listings l where l.id=any(r.ids) and l.summary ~* 'Advertiser: *agent')) then
      v_skipped := v_skipped + 1; continue;
    end if;
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
end $function$
;
update public.platform_settings set value=(value::jsonb||'{"landlords_only":true}'::jsonb)::text, updated_at=now(), updated_by='migration 20261014000005'
where key='hostunico_morning_leads';
