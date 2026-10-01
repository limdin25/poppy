-- One changing line per speaker, separate from the final transcript archive.
create table if not exists public.wk_hostunico_live_speech (
  call_id uuid not null references public.wk_calls(id) on delete cascade,
  speaker text not null check (speaker in ('agent','caller')),
  sequence bigint not null,
  utterance_id uuid not null default gen_random_uuid(),
  body text not null,
  is_final boolean not null,
  ts timestamptz not null default clock_timestamp(),
  primary key (call_id,speaker)
);
alter table public.wk_hostunico_live_speech enable row level security;
create policy hostunico_live_speech_read on public.wk_hostunico_live_speech
  for select to authenticated using (
    public.wk_is_admin() or exists (
      select 1 from public.wk_calls c where c.id = call_id and c.agent_id = auth.uid()
    )
  );
grant select on public.wk_hostunico_live_speech to authenticated;
grant all on public.wk_hostunico_live_speech to service_role;
alter publication supabase_realtime add table public.wk_hostunico_live_speech;

-- Twilio sequence numbers prevent a delayed partial from replacing a final.
create or replace function public.wk_hostunico_hear(
  p_call_id uuid, p_speaker text, p_sequence bigint, p_body text, p_final boolean
) returns jsonb language plpgsql security definer set search_path = public as $$
declare heard wk_hostunico_live_speech;
begin
  if not exists(select 1 from wk_calls where id = p_call_id and script_key = 'sa_call') then return null; end if;
  insert into wk_hostunico_live_speech as s(call_id,speaker,sequence,body,is_final)
    values(p_call_id,p_speaker,p_sequence,p_body,p_final)
    on conflict(call_id,speaker) do update set
      sequence = excluded.sequence, body = excluded.body, is_final = excluded.is_final,
      utterance_id = case when s.is_final then gen_random_uuid() else s.utterance_id end,
      ts = clock_timestamp()
    where excluded.sequence > s.sequence
    returning * into heard;
  return case when heard.call_id is null then null else to_jsonb(heard) end;
end $$;
revoke all on function public.wk_hostunico_hear(uuid,text,bigint,text,boolean) from public,anon,authenticated;
grant execute on function public.wk_hostunico_hear(uuid,text,bigint,text,boolean) to service_role;

-- Reuse the same card while a sentence grows. Only the current generation
-- may publish, including after a newer answer has started or finished.
create or replace function public.wk_hostunico_start_live_coach(
  p_call_id uuid, p_generation uuid, p_context text, p_sequence bigint, p_utterance uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare holder uuid; card_id uuid;
begin
  select generation_id into holder from wk_live_coach_locks where call_id = p_call_id for update;
  if holder is distinct from p_generation then return null; end if;
  if not exists(select 1 from wk_hostunico_live_speech where call_id = p_call_id and speaker = 'caller' and sequence = p_sequence) then return null; end if;
  select id into card_id from wk_live_coach_events where call_id = p_call_id
    and script_section = p_context and meta->>'utterance_id' = p_utterance::text
    order by ts desc limit 1;
  if card_id is null then
    insert into wk_live_coach_events(call_id,generation_id,kind,status,body,script_section,meta)
      values(p_call_id,p_generation,'suggestion','streaming','...',p_context,jsonb_build_object('utterance_id',p_utterance)) returning id into card_id;
  else
    update wk_live_coach_events set generation_id = p_generation where id = card_id;
  end if;
  return card_id;
end $$;
revoke all on function public.wk_hostunico_start_live_coach(uuid,uuid,text,bigint,uuid) from public,anon,authenticated;
grant execute on function public.wk_hostunico_start_live_coach(uuid,uuid,text,bigint,uuid) to service_role;

create or replace function public.wk_hostunico_write_coach(
  p_card uuid, p_generation uuid, p_body text, p_status text, p_meta jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare found_id uuid;
begin
  update wk_live_coach_events e set body = p_body, status = p_status, meta = coalesce(e.meta,'{}'::jsonb) || p_meta
    where e.id = p_card
      and (e.meta->>'source_sequence' is distinct from p_meta->>'source_sequence'
        or (length(p_body) >= length(e.body) and (e.status <> 'final' or p_status = 'final')))
      and (
      (e.generation_id = p_generation and exists(select 1 from wk_live_coach_locks l where l.call_id = e.call_id and l.generation_id = p_generation))
      or (
        -- A useful early guess may finish while a longer partial is in flight.
        -- Keep it only while the same sentence still extends that exact text.
        p_meta->>'provisional' = 'true'
        and coalesce((e.meta->>'source_sequence')::bigint,-1) < (p_meta->>'source_sequence')::bigint
        and exists(select 1 from wk_hostunico_live_speech s where s.call_id = e.call_id and s.speaker = 'caller'
          and not s.is_final and s.utterance_id::text = p_meta->>'utterance_id'
          and left(lower(s.body),length(p_meta->>'source_text')) = lower(p_meta->>'source_text')
          and substring(lower(s.body) from length(p_meta->>'source_text') + 1) !~ '\m(actually|instead|sorry|but|not)\M|i mean')
      )
    )
    returning e.id into found_id;
  return found_id is not null;
end $$;
revoke all on function public.wk_hostunico_write_coach(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.wk_hostunico_write_coach(uuid,uuid,text,text,jsonb) to service_role;
