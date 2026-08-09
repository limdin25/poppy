-- Let wk_calls.script_key say 'property_call' as well as 'vsl_close'.
--
-- The live coach (wk-voice-transcription) is driven by Twilio, not the browser,
-- and rebuilds its whole context from the database on every caller utterance.
-- The browser's in-memory "this is a property call" choice (scriptForCall.ts) is
-- invisible to it. This column is that choice, persisted when the call is
-- minted — the same reason it was added for the close call in
-- 20260731000002_call_script_key.sql, whose header explains it in full.
--
-- Without this row of SQL, Pedro reads the property script off his screen while
-- the coach prompts him through the plumber cold-call pitch.
--
-- STILL NULLABLE, STILL NO DEFAULT. Every existing row and every cold dial
-- leaves it NULL, and both branches in the coach are gated on a literal. So the
-- ~200 cold calls a day stay byte-identical.
--
-- Re-run safe: the constraint is dropped by name before being re-added.

ALTER TABLE wk_calls DROP CONSTRAINT IF EXISTS wk_calls_script_key_check;

ALTER TABLE wk_calls
  ADD CONSTRAINT wk_calls_script_key_check
  CHECK (script_key IS NULL OR script_key IN ('vsl_close', 'property_call'));

COMMENT ON COLUMN wk_calls.script_key IS
  'Sales script on the agent screen for this call. NULL = the normal cold-call script. vsl_close = the video-funnel close. property_call = ringing an estate agent about a house. Set by wk-calls-create from the dialer; read by wk-voice-transcription to pick the coaching.';
