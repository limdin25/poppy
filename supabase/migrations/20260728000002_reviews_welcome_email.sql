-- Welcome email for reviews buyers.
--
-- Until now a customer who paid received NOTHING — no receipt, no credentials,
-- no link. If they closed the Stripe success tab they had no artifact pointing
-- at go.heyelsie.com at all, and in 10 days their card was charged £99-£279.
--
-- One nullable stamp on a table that is already 1:1 with businesses (its PK IS
-- business_id), so no queue table and no new cron entry: the drain rides on the
-- existing every-minute /api/cron/notify-drain.
--
-- Stamped ONLY on a successful send — that's the idempotency key.

alter table public.review_settings
  add column if not exists welcome_email_sent_at timestamptz;
