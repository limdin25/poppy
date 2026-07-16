-- ────────────────────────────────────────────────────────────────────────────
-- CRM AI agent — per-channel settings (voice / email / whatsapp).
-- Powers /admin/crm/agent (the ported /agents UI for Maya).
--   · voice: system_prompt + greeting sync to Maya's Retell LLM/agent via
--     /api/crm/agent-config; voice_config holds the Retell call-feel params.
--   · email/whatsapp: same shape as the SMS warm-up so the engines can read
--     them when those channels go live (SMS itself stays in
--     wk_ai_reply_settings — that table drives the live engine, untouched).
-- Idempotent / re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wk_agent_channel_settings (
  channel                 text PRIMARY KEY
    CONSTRAINT wk_agent_channel_chk CHECK (channel IN ('voice', 'email', 'whatsapp')),
  display_name            text NOT NULL DEFAULT 'Maya',
  greeting                text,           -- voice: Retell begin_message
  system_prompt           text,           -- voice: Retell general_prompt
  model                   text NOT NULL DEFAULT 'claude-sonnet-4-6',
  enabled                 boolean NOT NULL DEFAULT false,   -- text channels only
  mode                    text NOT NULL DEFAULT 'draft'
    CONSTRAINT wk_agent_channel_mode_chk CHECK (mode IN ('draft', 'auto')),
  reply_delay_seconds     integer NOT NULL DEFAULT 45,
  max_replies_per_contact integer NOT NULL DEFAULT 5,
  hours_start             integer NOT NULL DEFAULT 0,
  hours_end               integer NOT NULL DEFAULT 24,
  days                    text[] NOT NULL DEFAULT ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'],
  timezone                text NOT NULL DEFAULT 'Europe/London',
  auto_off_on_human_reply boolean NOT NULL DEFAULT true,
  auto_off_on_booking     boolean NOT NULL DEFAULT true,
  handoff_keywords        text[] NOT NULL DEFAULT ARRAY['stop','human','agent','call me'],
  voice_config            jsonb NOT NULL DEFAULT '{}',      -- Retell agent params (voice row)
  updated_at              timestamptz NOT NULL DEFAULT now()
);

INSERT INTO wk_agent_channel_settings (channel)
  VALUES ('voice'), ('email'), ('whatsapp')
  ON CONFLICT (channel) DO NOTHING;

DROP TRIGGER IF EXISTS wk_agent_channel_settings_set_updated_at ON wk_agent_channel_settings;
CREATE TRIGGER wk_agent_channel_settings_set_updated_at
  BEFORE UPDATE ON wk_agent_channel_settings
  FOR EACH ROW EXECUTE FUNCTION wk_set_updated_at();

ALTER TABLE wk_agent_channel_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wk_agent_channel_settings_read ON wk_agent_channel_settings;
CREATE POLICY wk_agent_channel_settings_read ON wk_agent_channel_settings
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());
DROP POLICY IF EXISTS wk_agent_channel_settings_admin_all ON wk_agent_channel_settings;
CREATE POLICY wk_agent_channel_settings_admin_all ON wk_agent_channel_settings
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());
