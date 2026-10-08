-- Run inside a rollback transaction. Reserved test number only.
do $$
declare c uuid:=gen_random_uuid(); l uuid:=gen_random_uuid(); p uuid; st uuid;
begin
 select id into p from profiles where email='pedro@hostunico.com';
 select id into st from wk_pipeline_columns where pipeline_id='dadce4ac-90b5-4320-9291-ff6bb1cf89f0' and name='New lead';
 insert into wk_contacts(id,name,phone,desk,owner_agent_id,pipeline_column_id,ai_enabled,custom_fields) values(c,'Synthetic source guard test','+447700900982','sa',p,st,false,'{"lead_type":"hostunico_owner"}');
 insert into sa_listings(id,rightmove_id,source,wk_contact_id,agency,agency_phone,address,rent_pcm,source_price,bedrooms,hostunico_call_eligible) values(l,'codex-source-guard-check-20261008','rightmove',c,'Synthetic agent','+447700900982','Synthetic property',1000,'1000pcm',2,true);
 insert into wk_dialer_queue(campaign_id,contact_id,status,hostunico_uplift_hold) values('5d9657f9-d9b4-4e27-a2d1-83db80867f92',c,'skipped',true);
 insert into sa_property_reports(listing_id,remote_id,access_token,property,state,report_pitch) values(l,gen_random_uuid(),repeat('0',64),'{}','ready','{"planning":true,"monthlyGbpPence":200000,"askingRentGbpPence":100000}');
 if exists(select 1 from wk_dialer_queue where contact_id=c and status='pending') then raise exception 'Planning report released'; end if;
 update sa_property_reports set report_pitch='{"monthlyGbpPence":130000,"askingRentGbpPence":100000}' where listing_id=l;
 if not exists(select 1 from sa_listings where id=l and hostunico_uplift_status='eligible') then raise exception 'Verified Rightmove report did not qualify'; end if;
 if not exists(select 1 from wk_dialer_queue where contact_id=c and status='pending') then raise exception 'Verified report did not release queue'; end if;
 update sa_property_reports set report_pitch='{"monthlyGbpPence":129999,"askingRentGbpPence":100000}' where listing_id=l;
 if exists(select 1 from wk_dialer_queue where contact_id=c and status='pending') then raise exception 'Below threshold released'; end if;
end $$;
