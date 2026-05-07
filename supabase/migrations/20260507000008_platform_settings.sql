-- Platform-wide settings (API keys, model config, etc.)
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;

-- Seed default AI model
INSERT INTO platform_settings (key, value) VALUES
  ('ai_model', 'claude-sonnet-4-6'),
  ('ai_provider', 'anthropic')
ON CONFLICT (key) DO NOTHING;
