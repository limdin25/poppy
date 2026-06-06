-- Thread inbound/outbound emails by the provider's (Gmail/Outlook) thread id so a
-- back-and-forth stays in ONE conversation, even when the reply comes from a
-- different address (e.g. Elsie replying from hello@). Null = thread by contact.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS email_thread_id text;
CREATE INDEX IF NOT EXISTS idx_conversations_email_thread
  ON conversations(business_id, email_thread_id) WHERE email_thread_id IS NOT NULL;
