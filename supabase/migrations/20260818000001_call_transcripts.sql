-- The accurate transcript, made after the call from the recording.
--
-- WHY THIS EXISTS. Everything that judges a deal after the fact (the cockpit
-- brain via deal-timeline, the ballpark homework, the call review, the 5:30
-- report) reads wk_live_transcripts, which is Twilio's REAL-TIME transcription.
-- Realtime is the least accurate way to get those words and the most expensive:
-- measured 2026-08-18 on three of Pedro's own property calls, Twilio agreed
-- with a reference transcript on 86% of words against AssemblyAI's 93%, and
-- Twilio bills GBP 0.0204 a minute against roughly a third of a penny.
--
-- After the call there is no clock. So we transcribe the stored recording
-- properly and let the after-call readers prefer this table. The live coach is
-- untouched and keeps its realtime feed: this is not a replacement for it.
--
-- THE COLUMNS ARE DELIBERATELY IDENTICAL to wk_live_transcripts (call_id,
-- speaker, body, ts). A reader that can read one can read the other with no
-- reshaping, so nothing downstream has to learn a new shape and no prompt
-- changes meaning.

CREATE TABLE IF NOT EXISTS wk_call_transcripts (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id  uuid NOT NULL REFERENCES wk_calls(id) ON DELETE CASCADE,
  speaker  text NOT NULL CHECK (speaker IN ('agent', 'caller', 'unknown')),
  body     text NOT NULL,
  ts       timestamptz NOT NULL DEFAULT now(),
  -- Which engine produced it. A future swap can sit beside the old rows
  -- instead of overwriting them, so a bad engine is always comparable.
  source   text NOT NULL DEFAULT 'assemblyai',
  -- Position within the call. Ordering by ts alone is not enough: two
  -- utterances on opposite channels can share a millisecond.
  seq      int  NOT NULL DEFAULT 0
);

-- A re-run must not double the transcript. Same call, same engine, same
-- position is the same utterance.
CREATE UNIQUE INDEX IF NOT EXISTS wk_call_transcripts_unique_idx
  ON wk_call_transcripts (call_id, source, seq);

CREATE INDEX IF NOT EXISTS wk_call_transcripts_call_idx
  ON wk_call_transcripts (call_id, ts);

ALTER TABLE wk_call_transcripts ENABLE ROW LEVEL SECURITY;

-- Exactly the read rule wk_live_transcripts already carries: admins see
-- everything, an agent sees the calls they were on. Writes are service-role
-- only, so there is deliberately no INSERT/UPDATE/DELETE policy.
DROP POLICY IF EXISTS wk_call_transcripts_agent_read ON wk_call_transcripts;
CREATE POLICY wk_call_transcripts_agent_read ON wk_call_transcripts
  FOR SELECT TO authenticated
  USING (
    wk_is_admin() OR EXISTS (
      SELECT 1 FROM wk_calls c
      WHERE c.id = wk_call_transcripts.call_id AND c.agent_id = auth.uid()
    )
  );

-- Bookkeeping lives on the recording, not in a second table: the recording is
-- the thing being transcribed, and it already knows when it became readable.
ALTER TABLE wk_recordings
  ADD COLUMN IF NOT EXISTS transcript_status   text,
  ADD COLUMN IF NOT EXISTS transcript_error    text,
  ADD COLUMN IF NOT EXISTS transcript_attempts int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transcript_at       timestamptz;

-- The worker's queue: ready audio that has not been transcribed and has not
-- already failed too many times.
CREATE INDEX IF NOT EXISTS wk_recordings_transcript_todo_idx
  ON wk_recordings (created_at)
  WHERE status = 'ready' AND transcript_status IS DISTINCT FROM 'done';
