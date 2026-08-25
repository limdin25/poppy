-- Text first, WhatsApp second, and a record of what happened on the phone.
--
-- Hugo, 2026-08-25: "I think we have to have SMS first ... from there he can
-- call, he can SMS. If he already contacted via WhatsApp you should make a
-- little tag WhatsApp contacted ... then he can put the drop-down outcome of
-- the call, simple, even after the call."
--
-- WHY TEXT IS THE DEFAULT AND NOT A SECOND-BEST. A cold builder has never
-- messaged us, so his WhatsApp 24 hour window is shut and the ONLY thing that
-- can reach him is a Meta-approved template: fixed wording, no house detail
-- beyond the three slots, and blocked outright until Meta says yes. A text has
-- none of that. Pedro can write what the builder actually needs to know, send
-- it the moment he puts the phone down, and it lands on the same handset.
--
-- ONE ROW PER PROPERTY AND BUILDER STILL, so the two channels get two stamps
-- rather than two rows. `sent_at` keeps meaning "first contacted on anything"
-- because the daily cap and every existing read depend on it; the per-channel
-- stamps are what the WhatsApp-contacted tag reads, and they never overwrite
-- each other.

alter table public.brrr_builder_outreach
  add column if not exists channel text not null default 'whatsapp',
  add column if not exists sms_sent_at timestamptz,
  add column if not exists whatsapp_sent_at timestamptz,
  add column if not exists call_outcome text,
  add column if not exists call_outcome_at timestamptz,
  add column if not exists call_outcome_by text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'brrr_builder_outreach_channel_check'
  ) then
    alter table public.brrr_builder_outreach
      add constraint brrr_builder_outreach_channel_check
      check (channel in ('sms', 'whatsapp'));
  end if;
end $$;

comment on column public.brrr_builder_outreach.channel is
  'The channel the LAST send on this row went out on. sms is the default for anything sent from the Find builders desk; whatsapp is the template lane the crons use. The per-channel stamps below are the history, this is just the latest.';
comment on column public.brrr_builder_outreach.sms_sent_at is
  'When a text last went to this builder about this house. Never cleared.';
comment on column public.brrr_builder_outreach.whatsapp_sent_at is
  'When a WhatsApp template last went to this builder about this house. Never cleared, so the "WhatsApp contacted" tag survives a later text.';
comment on column public.brrr_builder_outreach.call_outcome is
  'What happened when a human rang this builder about this house, chosen from api/lib/builder-outreach.ts CALL_OUTCOMES. Free text is refused there rather than here so the words on the screen and the words in the column stay the same.';

-- Everything already sent went out as a WhatsApp template, because until today
-- that was the only sender that existed. Backfilling rather than leaving these
-- null is what makes the tag honest on the eight houses already in flight.
update public.brrr_builder_outreach
   set whatsapp_sent_at = sent_at
 where sent_at is not null
   and whatsapp_sent_at is null;

create index if not exists brrr_builder_outreach_call_outcome_idx
  on public.brrr_builder_outreach (property_id, call_outcome_at desc)
  where call_outcome is not null;
