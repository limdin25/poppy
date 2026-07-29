-- Make the AI caller's recordings and transcripts listenable in the CRM.
--
-- Hugo, 2026-07-29: "can you please build on the CRM there on the history...
-- where I can listen to all the calls recordings because I wanna listen to the
-- calls as well."
--
-- Until now every call left a WAV and a JSON transcript on the VPS, in
-- /opt/elsie-voice/bridge/transcripts, and nowhere else. 120 of them, 67 MB,
-- reachable only over ssh. That is fine for me and useless for Hugo, which
-- makes it the wrong place for the one artefact that tells you whether the
-- thing is working.
--
-- The audio goes to the existing private `call-recordings` bucket and only the
-- PATH is stored here, so the row stays small and the file is served through a
-- signed URL rather than being public. The transcript is small enough to live
-- in the row, and having it there means the list can show what was said
-- without fetching anything.

alter table wk_ai_called
  add column if not exists recording_path text,
  add column if not exists transcript      jsonb;

comment on column wk_ai_called.recording_path is
  'Object path inside the private call-recordings bucket. Serve with a signed URL.';
comment on column wk_ai_called.transcript is
  'The turns, as [{who, text, at}]. Small enough to inline, so the history page needs one query.';

-- The history page reads newest first, and almost always for one campaign.
create index if not exists wk_ai_called_recent
  on wk_ai_called (campaign, claimed_at desc);

-- Admins can read; the runner writes with the service role, which bypasses RLS.
-- The SELECT policy already exists from 20260729000003, and it covers the new
-- columns automatically because a policy is per row, not per column.
