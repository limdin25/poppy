-- Migration: Messaging V2 — clone HeyElsie's messaging system
-- Adds: AI handling, group chats, draft messages, AI settings, takeover queue

-- 1. conversations: AI handling + group support
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS ai_handling boolean DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group boolean DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_name text;

-- 2. channels: auto-reply settings
ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_reply_enabled boolean DEFAULT false;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS draft_mode boolean DEFAULT true;
ALTER TABLE channels ADD COLUMN IF NOT EXISTS auto_reply_delay_seconds integer DEFAULT 120;

-- 3. inbox_messages: status + sender_name
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS sender_name text;

-- Update status column: change from message delivery status to draft/sent status
-- First drop the old check constraint if it exists, then add new one
DO $$
BEGIN
  ALTER TABLE inbox_messages DROP CONSTRAINT IF EXISTS inbox_messages_status_check;
  ALTER TABLE inbox_messages ALTER COLUMN status SET DEFAULT 'sent';
  ALTER TABLE inbox_messages ADD CONSTRAINT inbox_messages_status_check
    CHECK (status IN ('sent', 'draft', 'failed', 'pending', 'delivered', 'read'));
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 4. AI settings (single-row, admin-only)
CREATE TABLE IF NOT EXISTS ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  openai_api_key text,
  system_prompt text DEFAULT '',
  model text DEFAULT 'gpt-4o-mini',
  max_tokens integer DEFAULT 500,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_ai_settings" ON ai_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Insert default row if table is empty
INSERT INTO ai_settings (system_prompt, model, max_tokens)
SELECT '', 'gpt-4o-mini', 500
WHERE NOT EXISTS (SELECT 1 FROM ai_settings);

-- 5. AI takeover queue
CREATE TABLE IF NOT EXISTS ai_takeover_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
  message_id uuid REFERENCES inbox_messages(id) ON DELETE SET NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'cancelled', 'owner_replied', 'ai_replied', 'expired')),
  scheduled_at timestamptz NOT NULL,
  grace_checked_at timestamptz,
  processed_at timestamptz,
  ai_reply_message_id uuid REFERENCES inbox_messages(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ai_takeover_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_ai_queue" ON ai_takeover_queue
  FOR ALL USING (true);

CREATE INDEX IF NOT EXISTS idx_ai_queue_pending
  ON ai_takeover_queue (status, scheduled_at)
  WHERE status = 'pending';
