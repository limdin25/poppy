-- Migration 005: Outstand.so parallel posting provider
-- Adds posting_settings, outstand_connections tables and provider tracking on scheduled_posts

-- 1. posting_settings (single-row config, like ai_settings)
CREATE TABLE IF NOT EXISTS posting_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  active_provider text NOT NULL DEFAULT 'heypubli'
    CHECK (active_provider IN ('heypubli', 'outstand')),
  outstand_api_key text,
  outstand_social_network_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE posting_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to posting_settings"
  ON posting_settings FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );

-- 2. Provider tracking on scheduled_posts
ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'heypubli'
    CHECK (provider IN ('heypubli', 'outstand'));

ALTER TABLE scheduled_posts
  ADD COLUMN IF NOT EXISTS outstand_post_id text;

-- 3. outstand_connections (maps influencer profile → Outstand social account)
CREATE TABLE IF NOT EXISTS outstand_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid REFERENCES profiles(id) UNIQUE NOT NULL,
  outstand_social_account_id text NOT NULL,
  ig_username text,
  is_connected boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE outstand_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to outstand_connections"
  ON outstand_connections FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );

CREATE POLICY "Influencer can view own outstand connection"
  ON outstand_connections FOR SELECT
  USING (profile_id = auth.uid());
