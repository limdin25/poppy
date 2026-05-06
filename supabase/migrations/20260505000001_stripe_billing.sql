-- Add Stripe billing columns to businesses
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS billing_status text NOT NULL DEFAULT 'none';
