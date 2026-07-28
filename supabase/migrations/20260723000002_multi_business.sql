-- Multi-business support for the Reviews app: a user can own several businesses
-- and switch the active one (Business Switcher + Add-Business wizard). The active
-- choice persists on the profile so it follows the user across devices.
-- Backward-compatible: NULL means "use the user's single/first business", exactly
-- as before, so existing single-business (and all receptionist) users are unaffected.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS active_business_id UUID REFERENCES public.businesses(id) ON DELETE SET NULL;
