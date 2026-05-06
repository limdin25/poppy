-- Track qualification and follow-up for booking flow
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS qualified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS follow_up_sent_at TIMESTAMPTZ;
