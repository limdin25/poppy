-- Add Retell-wired settings to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS language text DEFAULT 'en-GB';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS interruption_sensitivity numeric DEFAULT 0.9;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS max_call_duration_seconds integer DEFAULT 3600;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS post_call_analysis_model text DEFAULT 'gpt-4.1-mini';
