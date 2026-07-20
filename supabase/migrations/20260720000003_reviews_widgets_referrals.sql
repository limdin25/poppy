-- HeyElsie Reviews — widgets + referral program

-- Per-business widget editor settings (embeds also carry settings on the
-- script-tag query string, RH-style; this powers the dashboard editors).
CREATE TABLE IF NOT EXISTS public.review_widget_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  widget_type TEXT NOT NULL CHECK (widget_type IN ('popup','carousel','grid')),
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (business_id, widget_type)
);
ALTER TABLE public.review_widget_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_widget_settings_business ON public.review_widget_settings;
CREATE POLICY review_widget_settings_business ON public.review_widget_settings
  FOR ALL USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));

-- Referral program: £100/£100 gift after the invitee's first paid invoice.
-- v1 payout is manual (admin queue in /super).
CREATE TABLE IF NOT EXISTS public.review_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_business_id UUID REFERENCES public.businesses NOT NULL,
  referrer_user_id UUID,
  invitee_name TEXT,
  invitee_email TEXT,
  invitee_business_id UUID REFERENCES public.businesses,
  status TEXT NOT NULL DEFAULT 'invited',  -- invited | signed_up | paid | rewarded
  reward_note TEXT,
  rewarded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_referrals_referrer
  ON public.review_referrals (referrer_business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_referrals_invitee_email
  ON public.review_referrals (invitee_email);
ALTER TABLE public.review_referrals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS review_referrals_read ON public.review_referrals;
CREATE POLICY review_referrals_read ON public.review_referrals
  FOR SELECT USING (referrer_business_id IN (SELECT public.user_business_ids()));
