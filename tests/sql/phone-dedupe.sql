-- Behaviour tests. Run on the isolated fixture database, never against real leads.
begin;
do $$
declare c uuid; other uuid; stage uuid; first_at timestamptz; n int; q uuid;
begin
  foreach n in array array[1,2,3,4,5] loop
    if wk_normalize_phone((array['07700 900123','+44 7700-900123','447700900123','00447700900123','+44 (0)7700 900123'])[n]) <> '+447700900123' then raise exception 'normalization %', n; end if;
  end loop;
  if wk_normalize_phone('email:person123@example.com') is not null then raise exception 'email identity'; end if;
  insert into wk_contacts(name,phone,custom_fields) values('First','07700 900123','{"property_url":"https://example.test/one","notes":"Original note"}') returning id into c;
  insert into wk_contacts(name,phone,custom_fields) values('Second','+44 7700-900123','{"property_url":"https://example.test/two","notes":"Second note"}');
  if (select count(*) from wk_contacts where normalized_phone='+447700900123') <> 1 then raise exception 'duplicate contact'; end if;
  if not exists(select 1 from wk_activities where contact_id=c and meta->'incoming'->'custom_fields'->>'property_url'='https://example.test/two') then raise exception 'second listing lost'; end if;
  select admitted_at into first_at from wk_phone_registry where normalized_phone='+447700900123';
  perform wk_ingest_contacts('[{"name":"Third","phone":"447700900123","custom_fields":{"property_url":"https://example.test/three"}}]');
  if (select admitted_at from wk_phone_registry where normalized_phone='+447700900123') <> first_at then raise exception 'duplicate extends 30 days'; end if;
  insert into wk_dialer_queue(campaign_id,contact_id) values(gen_random_uuid(),c) returning id into q;
  insert into wk_dialer_queue(campaign_id,contact_id) values(gen_random_uuid(),c);
  if (select count(*) from wk_dialer_queue where contact_id=c and status='pending') <> 1 then raise exception 'two campaigns'; end if;
  update wk_dialer_queue set status='done' where id=q;
  insert into wk_dialer_queue(campaign_id,contact_id) values(gen_random_uuid(),c);
  if exists(select 1 from wk_dialer_queue where contact_id=c and status='pending') then raise exception 'readded inside 30 days'; end if;
  update wk_phone_registry set admitted_at=now()-interval '31 days',queued_at=now()-interval '31 days' where normalized_phone='+447700900123';
  perform wk_ingest_contacts('[{"name":"Fourth","phone":"07700900123"}]');
  if (select admitted_at from wk_phone_registry where normalized_phone='+447700900123') < now()-interval '1 second' then raise exception 'not readmitted after 30 days'; end if;
  insert into wk_dialer_queue(campaign_id,contact_id) values(gen_random_uuid(),c);
  if (select count(*) from wk_dialer_queue where contact_id=c and status='pending') <> 1 then raise exception 'not queued after 30 days'; end if;
  update wk_contacts set do_not_call=true where id=c;
  update wk_contacts set do_not_call=false where id=c;
  update wk_phone_registry set admitted_at=now()-interval '31 days' where normalized_phone='+447700900123';
  perform wk_ingest_contacts('[{"name":"DNC again","phone":"07700900123"}]');
  insert into wk_dialer_queue(campaign_id,contact_id) values(gen_random_uuid(),c);
  if exists(select 1 from wk_dialer_queue where contact_id=c and status in ('pending','dialing','connected')) then raise exception 'DNC queued'; end if;
  insert into wk_pipeline_columns(pipeline_id,name,position,dialer_closed) values(gen_random_uuid(),'Not interested',1,true) returning id into stage;
  insert into wk_contacts(name,phone,pipeline_column_id) values('Closed','07700900124',stage) returning id into other;
  update wk_phone_registry set admitted_at=now()-interval '31 days' where normalized_phone='+447700900124';
  perform wk_ingest_contacts('[{"name":"Closed again","phone":"07700900124"}]');
  if (select admitted_at from wk_phone_registry where normalized_phone='+447700900124') > now()-interval '30 days' then raise exception 'closed readmitted'; end if;
  insert into wk_dialer_queue(campaign_id,contact_id) values(gen_random_uuid(),other);
  if exists(select 1 from wk_dialer_queue where contact_id=other and status='pending') then raise exception 'closed queued'; end if;
  begin
    update wk_contacts set phone='07700900123' where id=other;
    raise exception 'phone update bypassed uniqueness';
  exception when unique_violation then null; end;
  -- The report's alternate mobile is another spelling of the same identity.
  insert into wk_contacts(name,phone,hostunico_sms_phone) values('Two phones','07700900125','07700900126') returning id into c;
  select id into other from wk_ingest_contacts('{"name":"Alternate number lead","phone":"+44 7700 900126","custom_fields":{"property_url":"https://example.test/alternate"}}');
  if c<>other then raise exception 'alternate mobile created another contact'; end if;
  update wk_contacts set do_not_call=true where id=c;
  if exists(select 1 from wk_phone_registry where contact_id=c and not do_not_contact) then raise exception 'DNC alias not suppressed'; end if;
  -- An import cannot backdate itself to evade the cooldown.
  insert into wk_contacts(name,phone,created_at) values('Backdated','07700900127',now()-interval '31 days') returning id into c;
  if (select admitted_at from wk_phone_registry where contact_id=c)<now()-interval '1 second' then raise exception 'backdated bypass'; end if;
  insert into wk_dialer_queue(campaign_id,contact_id) values(gen_random_uuid(),c) returning id into q;
  update wk_dialer_queue set status='done' where id=q;
  update wk_dialer_queue set status='pending' where id=q;
  if (select status from wk_dialer_queue where id=q)<>'done' then raise exception 'queue update bypass'; end if;
  update wk_phone_registry set admitted_at=now()-interval '30 days',queued_at=now()-interval '30 days' where contact_id=c;
  perform wk_ingest_contacts('{"name":"Exact boundary","phone":"07700900127"}');
  if (select admitted_at from wk_phone_registry where contact_id=c)<>now() then raise exception 'exact 30 day boundary'; end if;
end $$;
rollback;
