-- Many-to-many number <-> agent assignment for the CRM.
--
-- wk_numbers.assigned_agent_id was single-agent-per-number. Admins want to
-- assign multiple numbers to one agent AND the same number to multiple agents,
-- and to see (labelled) which number is where. This join table is the source of
-- truth; the send paths pick the sending agent's assigned number (see
-- wk-sms-send: country-matched -> primary -> first). Read = agents + admins,
-- write = admins.

CREATE TABLE IF NOT EXISTS wk_number_agents (
  number_id   uuid NOT NULL REFERENCES wk_numbers(id) ON DELETE CASCADE,
  agent_id    uuid NOT NULL,
  is_primary  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (number_id, agent_id)
);
CREATE INDEX IF NOT EXISTS wk_number_agents_agent_idx ON wk_number_agents(agent_id);

ALTER TABLE wk_number_agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wk_number_agents_read ON wk_number_agents;
CREATE POLICY wk_number_agents_read ON wk_number_agents
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());

DROP POLICY IF EXISTS wk_number_agents_admin_all ON wk_number_agents;
CREATE POLICY wk_number_agents_admin_all ON wk_number_agents
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());

-- ── Register / enable / label the account's numbers ──────────────────────────
-- The UK numbers are SMS-capable at Twilio (GB regulatory bundles approved); we
-- just hadn't flagged them sms_enabled. Give every number a human label so the
-- Settings screen shows "which number is where".

-- Spare UK line, not previously in wk_numbers.
INSERT INTO wk_numbers (e164, twilio_sid, voice_enabled, sms_enabled, recording_enabled,
                        max_calls_per_minute, cooldown_seconds_after_call, channel, provider, is_active, label)
SELECT '+447460035763', 'PN3a3ee43eaeb617cd59a51622b51e24cf', true, true, false,
       30, 0, 'sms', 'twilio', true, 'UK line 2 (+447460035763)'
WHERE NOT EXISTS (SELECT 1 FROM wk_numbers WHERE e164 = '+447460035763');

UPDATE wk_numbers SET sms_enabled = true, label = 'UK line 1 (+447576558278)' WHERE e164 = '+447576558278';
UPDATE wk_numbers SET label = 'US toll-free (+18774194389)'                     WHERE e164 = '+18774194389';
UPDATE wk_numbers SET label = 'US toll-free (+18333706994)'                     WHERE e164 = '+18333706994';
UPDATE wk_numbers SET label = 'UK receptionist line (+447426495169) - voice'    WHERE e164 = '+447426495169';
