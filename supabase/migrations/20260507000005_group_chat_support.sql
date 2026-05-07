-- WhatsApp group chat support
-- Adds group fields to conversations and sender attribution to messages

ALTER TABLE conversations ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS group_name TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS unipile_chat_id TEXT;
ALTER TABLE conversations ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_contact_id UUID REFERENCES contacts;

CREATE INDEX IF NOT EXISTS idx_conversations_unipile_chat_id
  ON conversations (unipile_chat_id) WHERE unipile_chat_id IS NOT NULL;
