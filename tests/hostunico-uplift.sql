-- Run inside a transaction and always roll back. No call or message is sent.
do $$
declare first_home record; second_home record; lead uuid; result text;
begin
  if wk_hostunico_uplift_state('ready','{"monthlyGbpPence":389999,"askingRentGbpPence":300000}',3000,true,'3000pcm')<>'excluded'
    or wk_hostunico_uplift_state('ready','{"monthlyGbpPence":390000,"askingRentGbpPence":300000}',3000,true,'3000pcm')<>'eligible'
    or wk_hostunico_uplift_state('ready','{"monthlyGbpPence":500000,"askingRentGbpPence":300000,"planning":true}',3000,true,'3000pcm')<>'pending'
    or wk_hostunico_uplift_state('ready','{"monthlyGbpPence":500000,"askingRentGbpPence":250000}',3000,true,'3000pcm')<>'pending'
    or wk_hostunico_uplift_state('ready','{"monthlyGbpPence":500000,"askingRentGbpPence":300000}',3000,true,'150pw')<>'pending'
    or not wk_hostunico_rent_matches('150pw',650)
    or wk_hostunico_rent_matches('150pw',600) then raise exception 'Threshold or weekly-price guard failed'; end if;
  select l.wk_contact_id into lead from sa_listings l join sa_property_reports r on r.listing_id=l.id
    where l.source='spareroom' and l.hostunico_call_eligible group by l.wk_contact_id having count(*)>=2 limit 1;
  if lead is null then raise exception 'Need a two-property contact for the rollback test'; end if;
  update sa_listings set rent_pcm=1000,source_price='1000pcm' where wk_contact_id=lead and source='spareroom';
  update sa_property_reports set state='ready',report_pitch='{"monthlyGbpPence":129999,"askingRentGbpPence":100000}'
    where listing_id in(select id from sa_listings where wk_contact_id=lead and source='spareroom');
  if wk_hostunico_outreach_allowed(lead) then raise exception 'Below-threshold contact passed'; end if;
  if exists(select 1 from wk_contacts where id=lead and pipeline_column_id is not null) then raise exception 'Excluded contact stayed in pipeline'; end if;
  update wk_dialer_queue set status='pending' where contact_id=lead and campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92';
  if exists(select 1 from wk_dialer_queue where contact_id=lead and campaign_id='5d9657f9-d9b4-4e27-a2d1-83db80867f92' and status='pending') then raise exception 'Requeue bypassed qualification'; end if;
  select l.id,r.report_url into first_home from sa_listings l join sa_property_reports r on r.listing_id=l.id where l.wk_contact_id=lead and l.hostunico_call_eligible order by l.id limit 1;
  select l.id,r.report_url into second_home from sa_listings l join sa_property_reports r on r.listing_id=l.id where l.wk_contact_id=lead and l.hostunico_call_eligible and l.id<>first_home.id order by l.id limit 1;
  update sa_property_reports set report_pitch='{"monthlyGbpPence":130000,"askingRentGbpPence":100000}' where listing_id=first_home.id;
  if not wk_hostunico_outreach_allowed(lead,'',first_home.id) then raise exception 'Exact 30 percent property blocked'; end if;
  if wk_hostunico_outreach_allowed(lead,'',second_home.id) then raise exception 'Other qualified property bypassed specific property block'; end if;
  if wk_hostunico_outreach_allowed(lead,'Here is your report: '||second_home.report_url) then raise exception 'Pasted SMS report bypassed block'; end if;
  if wk_hostunico_outreach_allowed(lead,'<a href="'||second_home.report_url||'">Report</a>') then raise exception 'Pasted email report bypassed block'; end if;
  if not wk_hostunico_outreach_allowed(lead,first_home.report_url) then raise exception 'Qualified report could not be sent'; end if;
  update sa_listings set rent_pcm=1100,source_price='1100pcm' where id=first_home.id;
  if wk_hostunico_outreach_allowed(lead) then raise exception 'Changed asking rent used stale report'; end if;
  update sa_property_reports set report_pitch='{"monthlyGbpPence":150000,"askingRentGbpPence":110000}' where listing_id=first_home.id;
  if not wk_hostunico_outreach_allowed(lead) then raise exception 'Corrected report did not recover qualification'; end if;
  update sa_property_reports set state='researching' where listing_id=first_home.id;
  if wk_hostunico_outreach_allowed(lead) then raise exception 'Unfinished report qualified'; end if;
end $$;
