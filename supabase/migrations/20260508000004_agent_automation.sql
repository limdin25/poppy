-- ============================================================
-- MIGRATION: Agent automation settings
-- Moves follow-up + auto-reply config into agents table
-- ============================================================

-- Add automation columns to agents
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS auto_reply_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS draft_mode BOOLEAN DEFAULT false;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS follow_up_enabled BOOLEAN DEFAULT true;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS follow_up_max_attempts INTEGER DEFAULT 2;
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS follow_up_delay_hours INTEGER[] DEFAULT '{2,24}';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS follow_up_preferred_channel TEXT DEFAULT 'same_channel';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS follow_up_tone TEXT DEFAULT 'friendly';
ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS follow_up_prompt TEXT;
