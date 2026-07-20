-- ============================================================
-- HeyElsie Reviews — the reviews product schema
-- Tables are multi-tenant (business_id + standard RLS) except
-- where noted. Suppression/compliance tables come first on
-- purpose: nothing sends without them.
-- ============================================================

-- ── Suppression list (STOP / manual do-not-contact / bounces) ──
-- Cross-channel: a STOP on SMS also blocks email/WhatsApp for that contact.
CREATE TABLE IF NOT EXISTS public.review_suppressions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  phone TEXT,
  email TEXT,
  reason TEXT NOT NULL DEFAULT 'stop_keyword', -- stop_keyword | manual | bounce | complaint
  source TEXT,                                 -- e.g. 'sms_webhook', 'dashboard', 'import_flag'
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_suppressions_phone
  ON public.review_suppressions (business_id, phone) WHERE phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_suppressions_email
  ON public.review_suppressions (business_id, email) WHERE email IS NOT NULL;

-- ── Per-business reviews settings ──
CREATE TABLE IF NOT EXISTS public.review_settings (
  business_id UUID PRIMARY KEY REFERENCES public.businesses,
  smart_messaging BOOLEAN NOT NULL DEFAULT TRUE,       -- AI-written request copy vs custom template
  sms_template TEXT,                                    -- custom template ({first_name} {business_name} {owner_name} {review_link})
  email_subject TEXT,
  email_template TEXT,
  followup_template TEXT,
  owner_first_name TEXT,
  business_display_name TEXT,                           -- nickname the AI uses in review replies
  followups_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  followup_count SMALLINT NOT NULL DEFAULT 2 CHECK (followup_count BETWEEN 0 AND 3),
  followup_gap_days SMALLINT NOT NULL DEFAULT 3 CHECK (followup_gap_days BETWEEN 1 AND 14),
  drip_per_day SMALLINT NOT NULL DEFAULT 25,            -- reactivation pacing
  quiet_start SMALLINT NOT NULL DEFAULT 9,              -- send window (recipient local, 24h)
  quiet_end SMALLINT NOT NULL DEFAULT 20,
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  sending_paused BOOLEAN NOT NULL DEFAULT FALSE,        -- per-business kill switch (the "Pause" button)
  image_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auto_reply_positive BOOLEAN NOT NULL DEFAULT TRUE,    -- auto-post AI replies to 4-5★
  auto_post_five_star BOOLEAN NOT NULL DEFAULT FALSE,   -- repurpose 5★ reviews as GBP posts
  sms_from_number TEXT,                                 -- assigned per-client Twilio long code
  inbound_token TEXT UNIQUE,                            -- Zapier/CRM inbound trigger auth
  attested_by TEXT,                                     -- PECR lawful-basis attestation
  attested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Personalized-image template ──
CREATE TABLE IF NOT EXISTS public.review_image_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  storage_path TEXT NOT NULL,          -- in the review-assets bucket
  public_url TEXT NOT NULL,
  name_x REAL NOT NULL DEFAULT 0.5,    -- relative 0-1 anchor for the first name
  name_y REAL NOT NULL DEFAULT 0.82,
  font_size SMALLINT NOT NULL DEFAULT 64,
  font_color TEXT NOT NULL DEFAULT '#ffffff',
  greeting_prefix TEXT NOT NULL DEFAULT 'Hi',  -- rendered as "Hi Sally!"
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_image_templates_business
  ON public.review_image_templates (business_id) WHERE is_active;

-- ── Google Business Profile connection (via Zernio) ──
CREATE TABLE IF NOT EXISTS public.gbp_connections (
  business_id UUID PRIMARY KEY REFERENCES public.businesses,
  zernio_profile_id TEXT NOT NULL,
  zernio_account_id TEXT,              -- Zernio SocialAccount id (set once location selected)
  gbp_location_id TEXT,
  gbp_account_name TEXT,
  location_name TEXT,
  place_id TEXT,
  review_url TEXT,                     -- Google "write a review" URL
  maps_url TEXT,
  avg_rating NUMERIC(2,1),
  total_reviews INT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | connected | disconnected | error
  connected_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Campaigns (a reactivation blast or the ongoing stream) ──
CREATE TABLE IF NOT EXISTS public.review_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'reactivation',  -- reactivation | ongoing
  status TEXT NOT NULL DEFAULT 'active',      -- active | paused | completed
  total_contacts INT NOT NULL DEFAULT 0,
  sent_count INT NOT NULL DEFAULT 0,
  reviewed_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_campaigns_business
  ON public.review_campaigns (business_id, created_at DESC);

-- ── Review requests: one row per contact per campaign (the funnel row) ──
-- The engine sends the initial ask, then follow-ups on the same row.
-- Only the INITIAL send counts toward the plan cap.
CREATE TABLE IF NOT EXISTS public.review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  contact_id UUID REFERENCES public.contacts NOT NULL,
  campaign_id UUID REFERENCES public.review_campaigns ON DELETE SET NULL,
  channel TEXT NOT NULL DEFAULT 'sms',        -- primary channel: sms | email
  status TEXT NOT NULL DEFAULT 'queued',      -- queued | in_progress | reviewed | no_review | opted_out | stopped | failed
  followups_sent SMALLINT NOT NULL DEFAULT 0,
  next_send_at TIMESTAMPTZ,                   -- when the engine acts on this row next
  first_sent_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,                     -- link click = smart-stop for follow-ups
  reviewed_at TIMESTAMPTZ,
  click_token TEXT UNIQUE,                    -- short-link token for /r/{token}
  image_url TEXT,
  message_body TEXT,                          -- what was actually sent (initial)
  twilio_sid TEXT,
  resend_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_requests_due
  ON public.review_requests (next_send_at) WHERE status IN ('queued','in_progress');
CREATE INDEX IF NOT EXISTS idx_review_requests_business
  ON public.review_requests (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_requests_contact
  ON public.review_requests (business_id, contact_id);

-- ── Funnel event log (dashboard + Zapier outbound) ──
CREATE TABLE IF NOT EXISTS public.review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  request_id UUID REFERENCES public.review_requests ON DELETE CASCADE,
  contact_id UUID REFERENCES public.contacts ON DELETE SET NULL,
  type TEXT NOT NULL,  -- request_sent | followup_sent | delivered | failed | clicked | reviewed | opted_out | reply_posted | contact_added
  channel TEXT,
  meta JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_events_business
  ON public.review_events (business_id, created_at DESC);

-- ── Synced Google reviews (via Zernio webhook + reconcile) ──
CREATE TABLE IF NOT EXISTS public.gbp_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  zernio_review_id TEXT NOT NULL,      -- full Google review resource name (stable)
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  reviewer_name TEXT,
  reviewer_photo TEXT,
  review_created_at TIMESTAMPTZ,
  review_updated_at TIMESTAMPTZ,
  has_reply BOOLEAN NOT NULL DEFAULT FALSE,
  reply_text TEXT,
  reply_posted_at TIMESTAMPTZ,
  ai_draft TEXT,
  ai_draft_status TEXT NOT NULL DEFAULT 'none',  -- none | pending_approval | posted | rejected
  matched_request_id UUID REFERENCES public.review_requests ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (business_id, zernio_review_id)
);
CREATE INDEX IF NOT EXISTS idx_gbp_reviews_business
  ON public.gbp_reviews (business_id, review_created_at DESC);

-- ── Monthly request metering (tier caps: 50 / 100 / 300) ──
CREATE TABLE IF NOT EXISTS public.review_usage (
  business_id UUID REFERENCES public.businesses NOT NULL,
  period_start DATE NOT NULL,
  requests_sent INT NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, period_start)
);

-- Atomic increment used by the send engine; returns the new total.
CREATE OR REPLACE FUNCTION public.review_usage_increment(b UUID, p DATE, n INT)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total INT;
BEGIN
  INSERT INTO review_usage (business_id, period_start, requests_sent)
  VALUES (b, p, n)
  ON CONFLICT (business_id, period_start)
  DO UPDATE SET requests_sent = review_usage.requests_sent + EXCLUDED.requests_sent
  RETURNING requests_sent INTO total;
  RETURN total;
END $$;
REVOKE ALL ON FUNCTION public.review_usage_increment(UUID, DATE, INT) FROM anon, authenticated;

-- Atomic claim of due review_requests rows for the send cron (mirrors the
-- SKIP LOCKED pattern used by claim_due_wakeup).
CREATE OR REPLACE FUNCTION public.claim_due_review_requests(batch INT)
RETURNS SETOF public.review_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE review_requests r SET next_send_at = now() + interval '10 minutes'
  WHERE r.id IN (
    SELECT id FROM review_requests
    WHERE status IN ('queued','in_progress') AND next_send_at <= now()
    ORDER BY next_send_at
    LIMIT batch
    FOR UPDATE SKIP LOCKED
  )
  RETURNING r.*;
END $$;
REVOKE ALL ON FUNCTION public.claim_due_review_requests(INT) FROM anon, authenticated;

-- ── Admin: per-client sender-number purchase queue (admin buys manually) ──
CREATE TABLE IF NOT EXISTS public.review_number_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | purchased | dismissed
  note TEXT,
  purchased_number TEXT,
  purchased_sid TEXT,
  actioned_by TEXT,
  actioned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_review_number_requests_pending
  ON public.review_number_requests (created_at) WHERE status = 'pending';

-- ── Outbound webhooks (Zapier "review received" / "request sent") ──
CREATE TABLE IF NOT EXISTS public.review_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  url TEXT NOT NULL,
  events TEXT[] NOT NULL DEFAULT ARRAY['review.received'],
  secret TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE public.review_suppressions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_image_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbp_connections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_requests        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gbp_reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_usage           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_number_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_webhooks        ENABLE ROW LEVEL SECURITY;

-- Full access for the owning business (settings & templates the client edits)
DROP POLICY IF EXISTS review_settings_business ON public.review_settings;
CREATE POLICY review_settings_business ON public.review_settings
  FOR ALL USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS review_image_templates_business ON public.review_image_templates;
CREATE POLICY review_image_templates_business ON public.review_image_templates
  FOR ALL USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS review_webhooks_business ON public.review_webhooks;
CREATE POLICY review_webhooks_business ON public.review_webhooks
  FOR ALL USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));

-- Read-only for the business; writes go through service-role API routes
-- (send engine, webhooks, admin) so clients can't forge funnel state.
DROP POLICY IF EXISTS review_suppressions_read ON public.review_suppressions;
CREATE POLICY review_suppressions_read ON public.review_suppressions
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS gbp_connections_read ON public.gbp_connections;
CREATE POLICY gbp_connections_read ON public.gbp_connections
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS review_campaigns_read ON public.review_campaigns;
CREATE POLICY review_campaigns_read ON public.review_campaigns
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS review_requests_read ON public.review_requests;
CREATE POLICY review_requests_read ON public.review_requests
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS review_events_read ON public.review_events;
CREATE POLICY review_events_read ON public.review_events
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS gbp_reviews_read ON public.gbp_reviews;
CREATE POLICY gbp_reviews_read ON public.gbp_reviews
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS review_usage_read ON public.review_usage;
CREATE POLICY review_usage_read ON public.review_usage
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS review_number_requests_read ON public.review_number_requests;
CREATE POLICY review_number_requests_read ON public.review_number_requests
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

-- ============================================================
-- Feature flag + storage bucket + CRM bridge
-- ============================================================
INSERT INTO public.feature_flag_definitions (key, name, description, default_enabled)
VALUES ('reviews', 'Reviews Product', 'HeyElsie Reviews — review-request engine, GBP integration, reviews dashboard', FALSE)
ON CONFLICT (key) DO NOTHING;

-- Public bucket for personalized images + image templates (service-role writes only)
INSERT INTO storage.buckets (id, name, public)
VALUES ('review-assets', 'review-assets', TRUE)
ON CONFLICT (id) DO NOTHING;

-- CRM bridge: link a CRM lead to the business account it became.
-- Guarded — wk_contacts only exists once the CRM port migration has run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'wk_contacts') THEN
    ALTER TABLE public.wk_contacts ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES public.businesses;
  END IF;
END $$;

-- updated_at trigger on review_settings (matches repo convention)
DROP TRIGGER IF EXISTS set_review_settings_updated_at ON public.review_settings;
CREATE TRIGGER set_review_settings_updated_at
  BEFORE UPDATE ON public.review_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
