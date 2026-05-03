ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS is_spam BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversations_is_spam
  ON public.conversations (business_id, is_spam)
  WHERE is_spam = true;
