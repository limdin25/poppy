-- Call-behaviour settings for the voice agent, editable from the app's
-- "Call behaviour" tab and pushed to Retell on sync. interruption_sensitivity
-- and max_call_duration_seconds already exist.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS start_speaker text;            -- 'agent' | 'user'
ALTER TABLE agents ADD COLUMN IF NOT EXISTS responsiveness numeric;        -- 0..1 (how quickly Elsie replies)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reminder_trigger_seconds integer; -- silence before re-prompt
ALTER TABLE agents ADD COLUMN IF NOT EXISTS reminder_max_count integer;    -- how many re-prompts
ALTER TABLE agents ADD COLUMN IF NOT EXISTS ambient_sound text;            -- background ambience id or null
