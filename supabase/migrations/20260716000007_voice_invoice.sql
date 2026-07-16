-- Voice invoicing: provenance + public share link
-- created_from: how the invoice was created (voice note, typed text, or manual form)
-- original_transcript: raw Whisper transcript the draft was extracted from
-- share_token: random token for the public invoice URL

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS created_from TEXT NOT NULL DEFAULT 'manual'
    CHECK (created_from IN ('voice_note','text','manual')),
  ADD COLUMN IF NOT EXISTS original_transcript TEXT,
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE;
