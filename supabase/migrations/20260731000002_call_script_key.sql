-- Which sales script the agent had on screen for THIS call.
--
-- The live coach (wk-voice-transcription) is driven by Twilio, not the browser,
-- and rebuilds its whole context from the database on every caller utterance.
-- So the browser's in-memory "this is a close call" choice (scriptForCall.ts)
-- was invisible to it, and the coach kept prompting the cold-call pitch while
-- the agent read the close script off the screen.
--
-- This column is that choice, persisted at the moment the call is minted.
--
-- NULLABLE with NO DEFAULT on purpose: every existing row and every cold dial
-- leaves it NULL, and the coach's close branch is gated on the literal
-- 'vsl_close'. So the ~200 cold calls a day are byte-identical to before.
-- The CHECK keeps it an enum, not a free-text field a client can stuff.

ALTER TABLE wk_calls
  ADD COLUMN IF NOT EXISTS script_key text
  CHECK (script_key IS NULL OR script_key IN ('vsl_close'));

COMMENT ON COLUMN wk_calls.script_key IS
  'Sales script on the agent screen for this call. NULL = the normal cold-call script. Set by wk-calls-create from the dialer; read by wk-voice-transcription to pick the coaching.';
