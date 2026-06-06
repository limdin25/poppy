-- Cartesia voice tuning, controllable from the Call behaviour tab and pushed to
-- the Retell agent on sync. Null = leave Retell's current value as-is.
-- voice_model + voice_emotion are gated to Cartesia/Minimax voices in sync-prompt.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS voice_model text;                    -- e.g. 'sonic-3.5' (Cartesia)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS voice_emotion text;                  -- 'happy' | 'calm' | ... (Cartesia/Minimax only)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS volume numeric;                      -- 0..2 (Retell default 1)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS enable_dynamic_voice_speed boolean;  -- adjust speed to the caller
