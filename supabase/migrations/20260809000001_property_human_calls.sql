-- Property calls made by a HUMAN agent, alongside the ones the AI makes.
--
-- Hugo, 2026-08-09, asked for Pedro to ring the estate agents himself rather
-- than the AI qualifier doing it. Both paths write to the SAME two tables
-- (brrr_properties, brrr_property_calls) so /admin/properties keeps showing one
-- timeline per property instead of two half-histories.
--
-- The AI is dark today (RETELL_PROPERTY_AGENT_ID and PROPERTY_FROM_NUMBER are
-- empty in production), but auto_queue_on_ingest is still true in
-- platform_settings and the dial cron still runs every 2 minutes. So the moment
-- those env vars are ever filled in, the AI would start ringing branches Pedro
-- is working — the same office, twice, from two numbers. That is the exact
-- complaint the cron's 30-minute same-agency spacing was added for
-- (api/cron/process-property-calls.ts:100-121, "I've just had a phone call from
-- the same number").
--
-- call_channel is the guard. One column, set per BRANCH (never per property, or
-- the AI would ring Pattinson about listing 7 while Pedro rings them about
-- listing 1). Default 'ai' so nothing about today's behaviour changes.
--
-- Re-run safe.

alter table public.brrr_properties
  add column if not exists call_channel text not null default 'ai',
  add column if not exists human_agent_id uuid references public.profiles(id),
  add column if not exists wk_contact_id uuid references public.wk_contacts(id) on delete set null;

do $$ begin
  alter table public.brrr_properties
    add constraint brrr_properties_call_channel_chk check (call_channel in ('ai', 'human'));
exception when duplicate_object then null;
end $$;

-- Which branch a property belongs to. The scraper stores whatever Rightmove
-- printed ("0191 625 0242") and the ingest route stores E.164 ("+441916250242")
-- — the last 9 digits are the same either way and that is what we group on.
-- Both regexp_replace and right are IMMUTABLE, so this is a legal index.
create index if not exists brrr_properties_agent_phone_tail_idx
  on public.brrr_properties (right(regexp_replace(coalesce(agent_phone, ''), '[^0-9]', '', 'g'), 9));

create index if not exists brrr_properties_channel_idx
  on public.brrr_properties (call_channel, status);

-- Same table, second channel. A human row is deliberately shaped so that every
-- existing AI query skips it without being changed:
--
--   the dial cron picks   status = 'pending'          -> human rows are 'completed'
--   handleBrrrCallEvent   matches on retell_call_id   -> human rows have NULL
--   sweepStuckExtractions .not('retell_call_id', is, null)
--   queuePropertyCall     checks ('pending','dialing')
--
-- The ONE deliberate crossover is the cron's same-agency spacing window, which
-- selects ('dialing','completed') and therefore DOES see human calls. That is
-- wanted: after Pedro rings a branch, the AI must not ring it for 30 minutes.
-- tests/property-human-call-isolation.test.ts pins all five of those.
alter table public.brrr_property_calls
  add column if not exists channel text not null default 'ai',
  add column if not exists human_agent_id uuid references public.profiles(id),
  add column if not exists wk_call_id uuid;

do $$ begin
  alter table public.brrr_property_calls
    add constraint brrr_property_calls_channel_chk check (channel in ('ai', 'human'));
exception when duplicate_object then null;
end $$;

comment on column public.brrr_properties.call_channel is
  'Who rings this branch: ai (the Retell qualifier) or human (a CRM agent through the dialer). Set per BRANCH by scripts/assign-properties-to-pedro-houses.mjs, never per property, so the two channels can never call the same office.';

comment on column public.brrr_property_calls.channel is
  'ai = a Retell call with a retell_call_id. human = a CRM dialer call, retell_call_id NULL, wk_call_id set.';
