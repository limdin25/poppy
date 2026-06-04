-- Advanced Retell call settings, controllable from the Call behaviour tab and
-- pushed to the Retell agent on sync. Null = leave Retell's current value as-is.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS backchannel_enabled boolean;     -- "mhm", "right" affirmations
ALTER TABLE agents ADD COLUMN IF NOT EXISTS backchannel_frequency numeric;   -- 0..1
ALTER TABLE agents ADD COLUMN IF NOT EXISTS begin_delay_ms integer;          -- pause before Elsie speaks (0..5000)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS end_silence_seconds integer;     -- hang up after this much silence (>=10)
ALTER TABLE agents ADD COLUMN IF NOT EXISTS voicemail_hangup boolean;        -- hang up if it reaches voicemail
ALTER TABLE agents ADD COLUMN IF NOT EXISTS allow_keypad boolean;            -- listen for keypad/DTMF
ALTER TABLE agents ADD COLUMN IF NOT EXISTS pronunciation_notes text;        -- "word -> say it like" hints (into the prompt)
