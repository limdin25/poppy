-- ============================================================
-- MIGRATION: Update billing pricing
-- £10/job (was £20), £200 cap (was £189), no activation fee
-- ============================================================

-- Update default cap amount on billing_periods
ALTER TABLE billing_periods ALTER COLUMN cap_amount SET DEFAULT 200;

-- Update default per-job amount on booking_events
ALTER TABLE booking_events ALTER COLUMN amount_raw SET DEFAULT 10.00;

-- Update any active billing periods that haven't been invoiced yet
UPDATE billing_periods
SET cap_amount = 200
WHERE status = 'active' AND cap_amount = 189;
