-- Draft mode: AI generates drafts by default instead of auto-sending
ALTER TABLE public.channels ADD COLUMN IF NOT EXISTS draft_mode BOOLEAN DEFAULT true;

-- Message status: track sent vs draft
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'sent';
