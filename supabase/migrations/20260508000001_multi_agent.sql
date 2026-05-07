-- ============================================================
-- MIGRATION: Multi-agent support
-- Adds agents table, modifies channels/services/faqs/knowledge_sources/conversations
-- ============================================================

-- ============================================================
-- 1. agents table
-- ============================================================
CREATE TABLE public.agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,

  name TEXT NOT NULL,
  description TEXT,
  agent_type TEXT NOT NULL CHECK (agent_type IN ('voice', 'whatsapp', 'sms', 'instagram', 'email')),
  is_default BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'draft', 'paused', 'archived')),

  -- Personality / behavior (NULL = inherit from business)
  greeting TEXT,
  tone TEXT,
  ai_system_prompt TEXT,
  ai_model TEXT,

  -- Response timing (NULL = inherit from business)
  takeover_delay_seconds INTEGER,
  after_hours_delay_seconds INTEGER,
  working_hours_start INTEGER,
  working_hours_end INTEGER,
  working_days TEXT[],

  -- Voice-specific (only for voice agents)
  voice_id TEXT,
  voice_speed NUMERIC,
  retell_agent_id TEXT,
  retell_llm_id TEXT,

  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_agents_business ON agents(business_id);
CREATE UNIQUE INDEX idx_agents_default ON agents(business_id) WHERE is_default = true;

CREATE TRIGGER agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agents_select" ON public.agents
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "agents_insert" ON public.agents
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "agents_update" ON public.agents
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "agents_delete" ON public.agents
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- ============================================================
-- 2. training_jobs table
-- ============================================================
CREATE TABLE public.training_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE,

  source_type TEXT NOT NULL CHECK (source_type IN ('website', 'google_places', 'document', 'pasted_text')),
  source_url TEXT,
  source_file_url TEXT,
  source_text TEXT,

  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,

  generated_config JSONB DEFAULT '{}',
  applied BOOLEAN DEFAULT false,
  applied_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_training_jobs_agent ON training_jobs(agent_id);

ALTER TABLE public.training_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "training_jobs_select" ON public.training_jobs
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "training_jobs_insert" ON public.training_jobs
  FOR INSERT WITH CHECK (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "training_jobs_update" ON public.training_jobs
  FOR UPDATE USING (business_id IN (SELECT public.user_business_ids()));
CREATE POLICY "training_jobs_delete" ON public.training_jobs
  FOR DELETE USING (business_id IN (SELECT public.user_business_ids()));

-- ============================================================
-- 3. Modify channels — add agent_id, label, instagram type, drop UNIQUE
-- ============================================================
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL;
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS label TEXT;

-- Drop the constraint that blocks multiple channels of the same type
ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_business_id_type_key;

-- Expand the type check to include instagram
ALTER TABLE public.channels DROP CONSTRAINT IF EXISTS channels_type_check;
ALTER TABLE public.channels ADD CONSTRAINT channels_type_check
  CHECK (type IN ('voice', 'whatsapp', 'sms', 'instagram', 'email_gmail', 'email_outlook', 'email_smtp'));

-- ============================================================
-- 4. Add agent_id to services, faqs, call_info_types, knowledge_sources
--    NULL = shared across all agents for this business
-- ============================================================
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL;
ALTER TABLE public.faqs ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL;
ALTER TABLE public.call_info_types ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL;
ALTER TABLE public.knowledge_sources ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id) ON DELETE CASCADE;

-- ============================================================
-- 5. Add agent_id to conversations (which agent handled this thread)
-- ============================================================
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.agents(id) ON DELETE SET NULL;

-- Expand conversation channel types to include instagram
ALTER TABLE public.conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE public.conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN ('voice', 'whatsapp', 'sms', 'email', 'instagram'));

-- ============================================================
-- 6. Migrate existing data: create a default agent per business
-- ============================================================
INSERT INTO public.agents (business_id, name, is_default, agent_type, status,
  retell_agent_id, retell_llm_id, voice_id, voice_speed)
SELECT
  b.id,
  'Main Agent',
  true,
  'voice',
  'active',
  c.config->>'retell_agent_id',
  c.config->>'retell_llm_id',
  c.config->>'voice_id',
  CASE WHEN c.config->>'voice_speed' IS NOT NULL
       THEN (c.config->>'voice_speed')::numeric
       ELSE NULL END
FROM public.businesses b
LEFT JOIN public.channels c ON c.business_id = b.id AND c.type = 'voice';

-- Point all existing channels to their business's default agent
UPDATE public.channels SET agent_id = (
  SELECT id FROM public.agents
  WHERE business_id = channels.business_id AND is_default = true
  LIMIT 1
);

-- Point all existing conversations to their business's default agent
UPDATE public.conversations SET agent_id = (
  SELECT id FROM public.agents
  WHERE business_id = conversations.business_id AND is_default = true
  LIMIT 1
);

-- ============================================================
-- 7. Enable realtime for agents table
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;
