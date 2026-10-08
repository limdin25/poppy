-- Apply the same researched earnings guard to both verified property sources.
CREATE OR REPLACE FUNCTION public.wk_hostunico_refresh_uplift(p_listing uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare lead_id uuid; next_state text; old_state text; held_stage text;
begin
  select wk_contact_id into lead_id from sa_listings where id=p_listing and (source='spareroom' or (source='rightmove' and exists(select 1 from wk_contacts c where c.id=sa_listings.wk_contact_id and c.custom_fields->>'lead_type'='hostunico_owner')));
  if lead_id is null then return; end if;
  -- Serialise all property results belonging to the same contact.
  select custom_fields->>'hostunico_sales_status',custom_fields->>'hostunico_held_stage'
    into old_state,held_stage from wk_contacts where id=lead_id and desk='sa' for update;
  if not found then return; end if;
  update sa_listings l set hostunico_uplift_status=wk_hostunico_uplift_state(r.state,r.report_pitch,l.rent_pcm,l.hostunico_call_eligible,l.source_price)
    from (select x.id,pr.state,pr.report_pitch from sa_listings x left join sa_property_reports pr on pr.listing_id=x.id where x.wk_contact_id=lead_id and x.source in ('spareroom','rightmove')) r
    where l.id=r.id and l.hostunico_uplift_status is distinct from wk_hostunico_uplift_state(r.state,r.report_pitch,l.rent_pcm,l.hostunico_call_eligible,l.source_price);
  select case when bool_or(hostunico_uplift_status='eligible') then 'eligible'
    when bool_or(hostunico_uplift_status='pending') then 'pending' else 'excluded' end into next_state
    from sa_listings where wk_contact_id=lead_id and source in ('spareroom','rightmove');
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
end $function$;

revoke all on function public.wk_hostunico_refresh_uplift(uuid) from public,anon,authenticated;
grant execute on function public.wk_hostunico_refresh_uplift(uuid) to service_role;
