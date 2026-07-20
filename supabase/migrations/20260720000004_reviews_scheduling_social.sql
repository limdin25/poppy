-- Scheduling: how long after a contact lands (CRM/Zapier trigger) before the
-- first review request goes out — Right away → 1 week, stored in hours.
-- Social posting: stamp when a 5★ review was repurposed as a GBP post so the
-- Social Posting page can show posted vs upcoming.

ALTER TABLE review_settings
  ADD COLUMN IF NOT EXISTS initial_delay_hours SMALLINT NOT NULL DEFAULT 0
  CHECK (initial_delay_hours BETWEEN 0 AND 168);

ALTER TABLE gbp_reviews
  ADD COLUMN IF NOT EXISTS social_posted_at TIMESTAMPTZ;
