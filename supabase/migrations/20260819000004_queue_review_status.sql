-- 'review' joins the queue's legal statuses.
--
-- The raw data command center (2026-08-19, see 20260819000003_raw_leads.sql)
-- parks scraped leads in wk_dialer_queue with status 'review': invisible to
-- the dialer (which selects 'pending' only) until Hugo's press on the raw
-- tab flips them. The status CHECK predated the flow and refused the word,
-- which is exactly what a first live run found: 79 demotions bounced off
-- wk_dialer_queue_status_check while their raw rows filed fine.

alter table wk_dialer_queue drop constraint wk_dialer_queue_status_check;
alter table wk_dialer_queue add constraint wk_dialer_queue_status_check
  check (status = any (array[
    'pending'::text, 'dialing'::text, 'connected'::text, 'voicemail'::text,
    'missed'::text, 'done'::text, 'skipped'::text, 'lost'::text,
    'review'::text
  ]));
