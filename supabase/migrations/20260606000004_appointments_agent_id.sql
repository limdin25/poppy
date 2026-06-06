-- Attribute each booking to the agent (phone number / A-B variant) that made it,
-- so analytics can show bookings + conversion per number. The booking tool already
-- knows the agent (passed as ?aid=). Backfilled from the linked conversation.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents(id) ON DELETE SET NULL;

UPDATE appointments a
SET agent_id = c.agent_id
FROM conversations c
WHERE a.conversation_id = c.id
  AND a.agent_id IS NULL
  AND c.agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_agent_id ON appointments(agent_id);
