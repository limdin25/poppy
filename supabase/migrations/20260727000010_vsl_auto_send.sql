-- Auto-send: arm the send at the moment the render is queued.
--
-- Hugo 2026-07-27: "where we click make their video it should say make their
-- video and send when ready. The agent knows exactly what's gonna happen."
--
-- Why this is a table change and not UI state: the agent arms it mid-call, then
-- hangs up and dials the next lead. The render lands ~10 minutes later, long
-- after that browser tab moved on. The intent has to outlive the page.
--
-- The exact message is stored WITH the arm. Re-templating at send time would
-- let an admin's settings edit change a message an agent already read out on
-- the phone.

alter table wk_vsl_pages
  add column if not exists auto_send_channel  text,
  add column if not exists auto_send_armed_at timestamptz,
  add column if not exists auto_send_by       uuid references profiles(id) on delete set null,
  add column if not exists auto_send_body     text,
  add column if not exists auto_send_subject  text,
  add column if not exists auto_send_error    text;

-- Constrain at the database, not only in the UI: the cron routes on this value
-- and a typo would mean a silently undeliverable arm.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wk_vsl_pages_auto_send_channel_check'
  ) then
    alter table wk_vsl_pages
      add constraint wk_vsl_pages_auto_send_channel_check
      check (auto_send_channel is null
             or auto_send_channel = any (array['sms'::text, 'whatsapp'::text, 'email'::text]));
  end if;
end $$;

-- The cron scans this every minute. Partial index: the armed set is tiny (a
-- handful at a time) next to 3,500 pages.
create index if not exists wk_vsl_pages_auto_send_idx
  on wk_vsl_pages (auto_send_armed_at)
  where auto_send_channel is not null;

comment on column wk_vsl_pages.auto_send_channel is
  'Armed send: sms | whatsapp | email. Cleared by api/cron/vsl-auto-send.ts when it fires, expires or gives up.';
comment on column wk_vsl_pages.auto_send_body is
  'The exact message the agent read before arming. Sent verbatim — never re-templated.';
comment on column wk_vsl_pages.auto_send_error is
  'Why the last arm did not send (render_failed | expired | no_destination | send_failed:…). Kept for the panel to explain itself.';

-- ---------------------------------------------------------------------------
-- REVERT (run by hand):
--   drop index if exists wk_vsl_pages_auto_send_idx;
--   alter table wk_vsl_pages drop constraint if exists wk_vsl_pages_auto_send_channel_check;
--   alter table wk_vsl_pages
--     drop column if exists auto_send_channel,
--     drop column if exists auto_send_armed_at,
--     drop column if exists auto_send_by,
--     drop column if exists auto_send_body,
--     drop column if exists auto_send_subject,
--     drop column if exists auto_send_error;
-- ---------------------------------------------------------------------------
