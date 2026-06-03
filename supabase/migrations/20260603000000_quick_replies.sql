-- ============================================================
-- Quick replies (Templates): saved canned responses a user or
-- Elsie can drop into a chat in one tap. Business-scoped.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES public.businesses NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quick_replies_business ON public.quick_replies (business_id, sort_order);

-- RLS: scope to the owning business (mirror the existing pattern)
ALTER TABLE public.quick_replies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quick_replies_business ON public.quick_replies;
CREATE POLICY quick_replies_business ON public.quick_replies
  FOR ALL USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));
