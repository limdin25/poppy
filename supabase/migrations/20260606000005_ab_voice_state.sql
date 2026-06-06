-- Tracks which A/B voice variant answers the NEXT inbound call per channel.
-- Flipped after every call by the Retell webhook so each agent gets one call
-- at a time (Emma → English → Emma → English…).
ALTER TABLE channels ADD COLUMN IF NOT EXISTS ab_next_agent_id uuid REFERENCES agents(id) ON DELETE SET NULL;
