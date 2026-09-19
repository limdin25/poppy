-- The fourth sales script: ringing an auctioneer about an unsold lot.
--
-- Same reasons, same shape as the property script (20260809000003 and
-- 20260809000004): the live coach is driven by Twilio and reads the script key
-- off the call row, so without 'auction_call' here Pedro would read the
-- auction script while the coach prompted him through the plumber pitch.
--
-- Its own singleton table, so editing one script can never touch another.
-- html NULL = use the bundled src/core/content/auction-call-script.html until
-- an admin saves an edit.

ALTER TABLE wk_calls DROP CONSTRAINT IF EXISTS wk_calls_script_key_check;

ALTER TABLE wk_calls
  ADD CONSTRAINT wk_calls_script_key_check
  CHECK (script_key IS NULL OR script_key IN ('vsl_close', 'property_call', 'auction_call'));

COMMENT ON COLUMN wk_calls.script_key IS
  'Sales script on the agent screen for this call. NULL = the normal cold-call script. vsl_close = the video-funnel close. property_call = ringing an estate agent about a house. auction_call = ringing an auctioneer about an unsold lot. Set by wk-calls-create from the dialer; read by wk-voice-transcription to pick the coaching.';

CREATE TABLE IF NOT EXISTS wk_auction_call_script (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  html        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

INSERT INTO wk_auction_call_script (id, html) VALUES (1, NULL)
  ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS wk_auction_call_script_set_updated_at ON wk_auction_call_script;
CREATE TRIGGER wk_auction_call_script_set_updated_at
  BEFORE UPDATE ON wk_auction_call_script
  FOR EACH ROW EXECUTE FUNCTION wk_set_updated_at();

ALTER TABLE wk_auction_call_script ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wk_auction_call_script_read ON wk_auction_call_script;
CREATE POLICY wk_auction_call_script_read ON wk_auction_call_script
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());

DROP POLICY IF EXISTS wk_auction_call_script_admin_all ON wk_auction_call_script;
CREATE POLICY wk_auction_call_script_admin_all ON wk_auction_call_script
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());
