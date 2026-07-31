-- Migration 007: one Instagram (Outstand) account maps to exactly one influencer.
-- Login looks accounts up by outstand_social_account_id and expects a single row;
-- without this, a duplicate mapping makes returning-user login ambiguous/error, and an
-- IG account could be re-bound to a second profile.

-- Drop any pre-existing duplicates first (keep the most recently created mapping).
DELETE FROM public.outstand_connections a
USING public.outstand_connections b
WHERE a.outstand_social_account_id = b.outstand_social_account_id
  AND a.created_at < b.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS uq_outstand_connections_social_account
  ON public.outstand_connections (outstand_social_account_id);
