-- The morning-of-the-viewing confirmation (Hugo, 2026-08-20: "the morning of
-- the visit you say hi good morning just wanna confirm we are still good for
-- the viewing today, like 8am").
--
-- One stamp, so the 8am cron can never text a builder twice before breakfast:
-- it is written BEFORE the wire call, so a lost Twilio response costs a
-- missing reminder rather than a duplicate.

alter table public.brrr_builder_outreach
  add column if not exists morning_sent_at timestamptz;

comment on column public.brrr_builder_outreach.morning_sent_at is
  'When the 8am day-of confirmation went to this builder. Stamped before the send, so a retry cannot double-text. Null means it has not gone yet.';
