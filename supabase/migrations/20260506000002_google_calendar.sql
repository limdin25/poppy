-- Google Calendar OAuth tokens stored per business
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS google_calendar_tokens JSONB DEFAULT NULL;

-- Track which calendar ID to use for availability + bookings
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS google_calendar_id TEXT DEFAULT NULL;
