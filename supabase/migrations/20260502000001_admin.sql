-- Admin panel tables and business column additions
-- No RLS on admin tables — accessed only via service role through API routes

-- Admin allowlist
CREATE TABLE admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text,
  created_at timestamptz DEFAULT now()
);

-- Audit log for admin actions
CREATE TABLE admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text NOT NULL,
  action text NOT NULL,
  target_type text,
  target_id uuid,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_audit_log_created ON admin_audit_log (created_at DESC);
CREATE INDEX idx_audit_log_admin ON admin_audit_log (admin_email);

-- Feature flag definitions (platform-wide)
CREATE TABLE feature_flag_definitions (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  default_enabled boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Per-business feature flags
CREATE TABLE feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  flag_key text NOT NULL REFERENCES feature_flag_definitions(key) ON DELETE CASCADE,
  enabled boolean DEFAULT false,
  metadata jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_id, flag_key)
);

-- System prompt version history
CREATE TABLE system_prompt_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  prompt_text text NOT NULL,
  version int NOT NULL,
  edited_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_prompt_versions ON system_prompt_versions (business_id, version DESC);

-- Add columns to businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS status text DEFAULT 'active';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS admin_notes text;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS plan text DEFAULT 'trial';

-- Add last_active tracking to team_members
ALTER TABLE team_members ADD COLUMN IF NOT EXISTS last_active_at timestamptz;

-- Seed default feature flag definitions
INSERT INTO feature_flag_definitions (key, name, description, default_enabled) VALUES
  ('voice_ai', 'Voice AI', 'AI-powered phone answering', true),
  ('sms_channel', 'SMS Channel', 'Two-way SMS messaging', false),
  ('whatsapp_channel', 'WhatsApp Channel', 'WhatsApp Business messaging', false),
  ('email_channel', 'Email Channel', 'Email auto-reply', false),
  ('booking_integration', 'Booking Integration', 'Cal.com calendar booking', false),
  ('quote_builder', 'Quote Builder', 'Generate and send quotes', false),
  ('invoice_builder', 'Invoice Builder', 'Generate and send invoices', false),
  ('multi_user', 'Multi-user Access', 'Team member invitations', false),
  ('custom_voice', 'Custom Voice', 'Custom Retell voice selection', false),
  ('api_access', 'API Access', 'External API access for integrations', false);
