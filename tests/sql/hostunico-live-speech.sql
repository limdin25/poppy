-- Apply with the migration in a rollback transaction. No actual calls or sends.
do $$
declare call_one uuid:=gen_random_uuid(); other_call uuid:=gen_random_uuid();
  turn jsonb; newer jsonb; first_gen uuid:=gen_random_uuid(); second_gen uuid:=gen_random_uuid();
  card uuid; same_card uuid; first_meta jsonb;
begin
  insert into wk_calls(id,direction,status,desk,script_key,agent_id)
    values(call_one,'outbound','completed','sa','sa_call','6b26172e-d98d-4cc4-9e22-b3b4e24624ee'),
          (other_call,'outbound','completed','houses','property_call','6b26172e-d98d-4cc4-9e22-b3b4e24624ee');
  if wk_hostunico_hear(other_call,'caller',1,'Wrong desk',false) is not null then raise exception 'Speech leaked into another desk'; end if;
  turn := wk_hostunico_hear(call_one,'caller',1,'How do guests get in',false);
  perform wk_acquire_coach_lock(call_one,first_gen,true,180);
  card := wk_hostunico_start_live_coach(call_one,first_gen,'test-context',1,(turn->>'utterance_id')::uuid);
  if card is null then raise exception 'No early card'; end if;
  first_meta := jsonb_build_object('source_sequence',1,'source_text','How do guests get in','utterance_id',turn->>'utterance_id','provisional',true);
  newer := wk_hostunico_hear(call_one,'caller',2,'How do guests get into the property',false);
  if turn->>'utterance_id' <> newer->>'utterance_id' then raise exception 'Partial created a second turn'; end if;
  perform wk_acquire_coach_lock(call_one,second_gen,true,180);
  same_card := wk_hostunico_start_live_coach(call_one,second_gen,'test-context',2,(turn->>'utterance_id')::uuid);
  if same_card <> card then raise exception 'Sentence stacked cards'; end if;
  if not wk_hostunico_write_coach(card,first_gen,'SAY: Early access answer.','final',first_meta) then raise exception 'A useful early result was starved by new partials'; end if;
  perform wk_hostunico_write_coach(card,second_gen,'SAY: Newer access answer.','final',first_meta || '{"source_sequence":2}'::jsonb);
  if wk_hostunico_write_coach(card,first_gen,'SAY: Stale guess.','final',first_meta) then raise exception 'Old guess overwrote newer answer'; end if;
  perform wk_hostunico_hear(call_one,'caller',3,'How do guests get in, actually I mean messages',false);
  if wk_hostunico_write_coach(card,first_gen,'SAY: Wrong access answer.','final',first_meta) then raise exception 'Old guess survived a correction'; end if;
  newer := wk_hostunico_hear(call_one,'caller',4,'Who handles guest messages?',true);
  if wk_hostunico_hear(call_one,'caller',3,'Old partial',false) is not null then raise exception 'Late partial replaced final'; end if;
  if wk_hostunico_hear(call_one,'caller',4,'Retry of final',true) is not null then raise exception 'Duplicate final accepted'; end if;
  if wk_hostunico_write_coach(card,first_gen,'SAY: Old guess after final.','final',first_meta) then raise exception 'Old partial replaced final question'; end if;
  if wk_hostunico_start_live_coach(call_one,second_gen,'test-context',3,(turn->>'utterance_id')::uuid) is not null then raise exception 'Stale request started a card'; end if;
  newer := wk_hostunico_hear(call_one,'caller',5,'What about cleaning',false);
  if newer->>'utterance_id' = turn->>'utterance_id' then raise exception 'New question reused old turn'; end if;
  perform wk_hostunico_hear(call_one,'agent',6,'A local cleaner handles changeovers',false);
  if (select count(*) from wk_hostunico_live_speech where call_id=call_one) <> 2 then raise exception 'Speech did not separate speakers'; end if;
  if has_function_privilege('authenticated','public.wk_hostunico_hear(uuid,text,bigint,text,boolean)','execute') then raise exception 'Client can forge speech'; end if;
  if has_function_privilege('anon','public.wk_hostunico_write_coach(uuid,uuid,text,text,jsonb)','execute') then raise exception 'Public can write coach'; end if;
  perform set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
  set local role authenticated;
  if exists(select 1 from wk_hostunico_live_speech where call_id=call_one) then raise exception 'Another agent sees private speech'; end if;
  reset role;
  perform set_config('request.jwt.claims','{"sub":"6b26172e-d98d-4cc4-9e22-b3b4e24624ee","role":"authenticated"}',true);
  set local role authenticated;
  if (select count(*) from wk_hostunico_live_speech where call_id=call_one) <> 2 then raise exception 'Assigned agent cannot read speech'; end if;
  reset role;
end $$;
