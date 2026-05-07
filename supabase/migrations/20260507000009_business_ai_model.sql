-- Per-business AI model override (null = use global default from platform_settings)
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS ai_model TEXT;
