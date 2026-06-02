-- ============================================================
-- Leads: classify contacts as HOT / WARM / COLD from conversation intent
-- ============================================================
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_status text DEFAULT 'new';
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_score int;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_reason text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS lead_updated_at timestamptz;

-- lead_status: 'new' | 'hot' | 'warm' | 'cold'
CREATE INDEX IF NOT EXISTS idx_contacts_lead_status
  ON public.contacts (business_id, lead_status);
