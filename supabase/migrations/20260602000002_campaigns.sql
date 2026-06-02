-- ============================================================
-- Campaigns: bulk outbound WhatsApp blasts to a filtered audience
-- ============================================================
CREATE TABLE IF NOT EXISTS public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  message_template TEXT NOT NULL,
  audience_filter JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft', -- draft | sending | sent | failed
  recipient_count INT DEFAULT 0,
  sent_count INT DEFAULT 0,
  failed_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES public.campaigns ON DELETE CASCADE NOT NULL,
  contact_id UUID REFERENCES public.contacts NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed
  sent_at TIMESTAMPTZ,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_campaigns_business ON public.campaigns (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign ON public.campaign_recipients (campaign_id);

-- RLS: scope to the owning business (mirror the existing pattern)
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS campaigns_business ON public.campaigns;
CREATE POLICY campaigns_business ON public.campaigns
  FOR ALL USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS campaign_recipients_business ON public.campaign_recipients;
CREATE POLICY campaign_recipients_business ON public.campaign_recipients
  FOR ALL USING (
    campaign_id IN (SELECT id FROM public.campaigns WHERE business_id IN (SELECT public.user_business_ids()))
  )
  WITH CHECK (
    campaign_id IN (SELECT id FROM public.campaigns WHERE business_id IN (SELECT public.user_business_ids()))
  );
