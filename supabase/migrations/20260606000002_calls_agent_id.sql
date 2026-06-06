-- Attribute each call to a specific phone number's agent, so calls (and the
-- inbox) can be filtered per-number. Backfilled from the call's conversation.
ALTER TABLE calls ADD COLUMN IF NOT EXISTS agent_id uuid REFERENCES agents(id) ON DELETE SET NULL;

UPDATE calls c
SET agent_id = conv.agent_id
FROM conversations conv
WHERE c.conversation_id = conv.id
  AND c.agent_id IS NULL
  AND conv.agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_calls_agent_id ON calls(agent_id);
