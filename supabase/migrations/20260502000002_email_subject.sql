-- Add subject column to conversations for email thread grouping
-- Each unique subject from the same contact = separate conversation
ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS subject TEXT;

-- Index for efficient email thread lookup
CREATE INDEX IF NOT EXISTS idx_conversations_email_thread
  ON public.conversations (business_id, contact_id, channel, subject)
  WHERE channel = 'email';
