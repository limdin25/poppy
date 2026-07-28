-- Social Posting (Facebook / Instagram via Zernio) — the review-to-social
-- automation module on go.heyelsie.com/social. Mirrors the competitor's feature:
-- connect FB/IG accounts, choose a caption source, a per-day posting schedule,
-- a review queue, and reusable image templates. Publishing goes out through the
-- SAME Zernio account already used for Google Business Profile (one Zernio
-- profile per business, stored on gbp_connections.zernio_profile_id).

-- ── Connected FB/IG accounts (one row per connected account) ──
CREATE TABLE IF NOT EXISTS public.social_connections (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  platform           TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram')),
  zernio_account_id  TEXT NOT NULL,                 -- Zernio account _id used when posting
  account_name       TEXT,                          -- page / IG display name
  username           TEXT,                          -- @handle where available
  avatar_url         TEXT,
  status             TEXT NOT NULL DEFAULT 'connected',  -- connected | disconnected
  connected_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, platform, zernio_account_id)
);
CREATE INDEX IF NOT EXISTS idx_social_connections_business
  ON public.social_connections (business_id) WHERE status = 'connected';

-- ── Per-business social config: caption source + auto-post schedule ──
CREATE TABLE IF NOT EXISTS public.social_settings (
  business_id        UUID PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  caption_mode       TEXT NOT NULL DEFAULT 'custom'      -- comment | reply | custom
                       CHECK (caption_mode IN ('comment', 'reply', 'custom')),
  custom_caption     TEXT,                                -- used when caption_mode = 'custom'
  auto_enabled       BOOLEAN NOT NULL DEFAULT FALSE,      -- master auto-posting switch
  -- Per-day publishing: { "monday": {"story": false, "feed": true}, ... }
  schedule           JSONB NOT NULL DEFAULT '{
    "monday":{"story":false,"feed":false},"tuesday":{"story":false,"feed":false},
    "wednesday":{"story":false,"feed":false},"thursday":{"story":false,"feed":false},
    "friday":{"story":false,"feed":false},"saturday":{"story":false,"feed":false},
    "sunday":{"story":false,"feed":false}}'::jsonb,
  active_feed_template_id   UUID,   -- FK set below (nullable, ON DELETE SET NULL)
  active_story_template_id  UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Reusable image templates (feed = square, story = 9:16) ──
CREATE TABLE IF NOT EXISTS public.social_templates (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name               TEXT NOT NULL DEFAULT 'Untitled template',
  type               TEXT NOT NULL DEFAULT 'feed' CHECK (type IN ('feed', 'story')),
  background_url     TEXT NOT NULL,                 -- preset URL or uploaded (review-assets bucket)
  background_kind    TEXT NOT NULL DEFAULT 'preset',-- preset | upload
  -- Review card placement, resolution-independent (0-1 relative to the canvas)
  card_x             REAL NOT NULL DEFAULT 0.5,
  card_y             REAL NOT NULL DEFAULT 0.5,
  card_scale         REAL NOT NULL DEFAULT 0.8,     -- 0-1 of canvas width
  star_color         TEXT NOT NULL DEFAULT '#ffd700',
  text_color         TEXT NOT NULL DEFAULT '#000000',
  bg_color           TEXT NOT NULL DEFAULT '#ffffff',
  border_color       TEXT NOT NULL DEFAULT '#000000',
  caption_length     TEXT NOT NULL DEFAULT 'medium' CHECK (caption_length IN ('short', 'medium', 'long')),
  overlay_elements   JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ url, x, y, w }]
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_social_templates_business
  ON public.social_templates (business_id, created_at DESC);

ALTER TABLE public.social_settings
  ADD CONSTRAINT social_settings_feed_template_fk
  FOREIGN KEY (active_feed_template_id) REFERENCES public.social_templates(id) ON DELETE SET NULL;
ALTER TABLE public.social_settings
  ADD CONSTRAINT social_settings_story_template_fk
  FOREIGN KEY (active_story_template_id) REFERENCES public.social_templates(id) ON DELETE SET NULL;

-- ── The post queue: reviews scheduled / published to social ──
CREATE TABLE IF NOT EXISTS public.social_post_queue (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id        UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  review_id          UUID NOT NULL REFERENCES public.gbp_reviews(id) ON DELETE CASCADE,
  template_id        UUID REFERENCES public.social_templates(id) ON DELETE SET NULL,
  post_type          TEXT NOT NULL DEFAULT 'feed' CHECK (post_type IN ('feed', 'story')),
  caption            TEXT,
  image_url          TEXT,
  status             TEXT NOT NULL DEFAULT 'queued'      -- queued | scheduled | publishing | published | failed | skipped
                       CHECK (status IN ('queued', 'scheduled', 'publishing', 'published', 'failed', 'skipped')),
  scheduled_for      TIMESTAMPTZ,
  published_at       TIMESTAMPTZ,
  results            JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{ platform, zernioPostId, url, ok, error }]
  error              TEXT,
  priority           INT NOT NULL DEFAULT 0,             -- higher = sooner (manual bump)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, review_id)
);
CREATE INDEX IF NOT EXISTS idx_social_post_queue_business
  ON public.social_post_queue (business_id, status, priority DESC, created_at);

-- ── updated_at triggers (repo convention: set_updated_at) ──
DROP TRIGGER IF EXISTS set_social_settings_updated_at ON public.social_settings;
CREATE TRIGGER set_social_settings_updated_at
  BEFORE UPDATE ON public.social_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_social_templates_updated_at ON public.social_templates;
CREATE TRIGGER set_social_templates_updated_at
  BEFORE UPDATE ON public.social_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_social_post_queue_updated_at ON public.social_post_queue;
CREATE TRIGGER set_social_post_queue_updated_at
  BEFORE UPDATE ON public.social_post_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS: each business owns its own social rows (client-facing on go.) ──
ALTER TABLE public.social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_settings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_templates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_queue  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_connections_business ON public.social_connections;
CREATE POLICY social_connections_business ON public.social_connections
  FOR ALL USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS social_settings_business ON public.social_settings;
CREATE POLICY social_settings_business ON public.social_settings
  FOR ALL USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS social_templates_business ON public.social_templates;
CREATE POLICY social_templates_business ON public.social_templates
  FOR ALL USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));

DROP POLICY IF EXISTS social_post_queue_business ON public.social_post_queue;
CREATE POLICY social_post_queue_business ON public.social_post_queue
  FOR ALL USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));
