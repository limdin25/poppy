-- Reviews onboarding: capture which software the client uses (for the future
-- CRM integration, built one at a time) and store any files they upload during
-- onboarding (customer-list screenshots, invoices) for the team to action.

-- Which job/booking software the client uses. One of:
--   jobber | housecall_pro | servicetitan | quickbooks | google_contacts | other | none
ALTER TABLE public.review_settings
  ADD COLUMN IF NOT EXISTS crm_provider TEXT;

-- Files uploaded during onboarding when the client can't export a clean CSV
-- (screenshots of contacts, photos of invoices). Stored in the crm-attachments
-- bucket; this table tracks them so the team can turn them into contacts.
CREATE TABLE IF NOT EXISTS public.review_onboarding_uploads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id   UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  storage_path  TEXT NOT NULL,
  original_name TEXT,
  content_type  TEXT,
  kind          TEXT,                              -- e.g. 'onboarding'
  crm_provider  TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | processed
  created_by    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_onboarding_uploads_business
  ON public.review_onboarding_uploads (business_id);

ALTER TABLE public.review_onboarding_uploads ENABLE ROW LEVEL SECURITY;

-- A logged-in client can see/insert their own onboarding uploads (mirrors the
-- review_image_templates_business policy). The API route uses the service role,
-- so it bypasses this anyway; the policy is for direct client reads.
DROP POLICY IF EXISTS review_onboarding_uploads_business ON public.review_onboarding_uploads;
CREATE POLICY review_onboarding_uploads_business ON public.review_onboarding_uploads
  FOR ALL
  USING (business_id IN (SELECT public.user_business_ids()))
  WITH CHECK (business_id IN (SELECT public.user_business_ids()));
