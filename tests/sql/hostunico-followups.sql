-- Run inside a transaction after the migrations, then ROLLBACK. No messages are sent.
do $$
declare lead uuid:=gen_random_uuid(); now_at timestamptz:=now(); phase integer; got integer; kind text;
begin
  perform set_config('request.jwt.claims','{"sub":"6b26172e-d98d-4cc4-9e22-b3b4e24624ee","role":"authenticated"}',true);
  insert into wk_contacts(id,name,phone,desk,owner_agent_id,ai_enabled) values(lead,'Hostunico rollback test','+447700900999','sa','6b26172e-d98d-4cc4-9e22-b3b4e24624ee',false);
  insert into wk_sms_messages(contact_id,direction,body,from_e164,status,created_at) values(lead,'outbound','Report fixture only','+447700900998','sent',now_at-interval '10 days');
  for phase in 0..3 loop
    insert into sa_report_followups(contact_id,report_sent_at,sent_steps) values(lead,now_at-interval '10 days','{}')
    on conflict(contact_id) do update set report_sent_at=case when phase=0 then now_at-interval '1 hour' else now_at-interval '10 days' end,
      replied_at=null,intent=null,cold_at=null,send_state='idle',sent_steps=case when phase=2 then jsonb_build_object('step1',now_at-interval '3 days') when phase=3 then jsonb_build_object('step1',now_at-interval '8 days','step2',now_at-interval '6 days') else '{}'::jsonb end;
    insert into wk_sms_messages(contact_id,direction,body,from_e164,status,created_at) values(lead,'inbound','Yes, tell me about onboarding','+447700900999','received',now_at+phase*interval '1 second');
    if not exists(select 1 from sa_report_followups where contact_id=lead and replied_at is not null and intent='neutral' and classification_pending) then raise exception 'Reply did not immediately stop phase %',phase; end if;
    if sa_claim_followup(lead,'step1') then raise exception 'Reply allowed a send in phase %',phase; end if;
    select count(*) into got from wk_callbacks_open(48,'sa') where contact_id=lead;
    if got<>1 then raise exception 'Reply strip missing phase %',phase; end if;
  end loop;
  update sa_report_followups set replied_at=null,intent=null where contact_id=lead;
  insert into wk_sms_messages(contact_id,direction,body,from_e164,status,created_at) values(lead,'inbound','STOP','+447700900999','received',now_at+interval '10 seconds');
  if not exists(select 1 from wk_contacts where id=lead and do_not_call) or not exists(select 1 from wk_contact_tags where contact_id=lead and tag='do-not-text') then raise exception 'STOP suppression missing'; end if;
  if exists(select 1 from wk_callbacks_open(48,'sa') where contact_id=lead) then raise exception 'Negative reply should not demand a callback'; end if;
  update sa_report_followups set replied_at=null,intent=null where contact_id=lead;
  insert into wk_sms_messages(contact_id,direction,channel,body,from_e164,status,created_at) values(lead,'inbound','email','Property question','test@example.invalid','received',now_at+interval '20 seconds');
  if not exists(select 1 from sa_report_followups where contact_id=lead and reply_kind='email' and replied_at is not null) then raise exception 'Email did not stop sequence'; end if;
  update sa_report_followups set replied_at=null,intent=null where contact_id=lead;
  insert into wk_calls(direction,status,from_e164,started_at,created_at) values('inbound','ringing','+447700900999',now_at+interval '30 seconds',now_at+interval '30 seconds');
  if not exists(select 1 from sa_report_followups where contact_id=lead and reply_kind='call' and replied_at is not null) then raise exception 'Phone match did not stop sequence'; end if;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  if exists(select 1 from wk_callbacks_open(48,'sa') where contact_id=lead) then raise exception 'Strip leaked another agents lead'; end if;
end $$;
