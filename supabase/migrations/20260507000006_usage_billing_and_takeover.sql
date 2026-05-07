-- ============================================================
-- MIGRATION: Usage-based billing + AI takeover queue
-- ============================================================

-- Add billing & onboarding columns to businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS currency text DEFAULT 'GBP'
  CHECK (currency IN ('GBP', 'USD', 'EUR'));
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS billing_active boolean DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS billing_started_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS contract_signed_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS activation_credit_paid boolean DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS active_channels text[] DEFAULT '{phone}';
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS country_code text;

-- ============================================================
-- Billing periods: one row per business per 30-day cycle
-- ============================================================
CREATE TABLE billing_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,

  booking_count integer DEFAULT 0,
  total_amount numeric(10,2) DEFAULT 0,
  total_before_cap numeric(10,2) DEFAULT 0,

  cap_amount numeric(10,2) NOT NULL DEFAULT 189,
  cap_reached boolean DEFAULT false,
  cap_reached_at timestamptz,

  currency text NOT NULL CHECK (currency IN ('GBP', 'USD', 'EUR')),

  stripe_invoice_id text,
  stripe_invoice_status text,
  paid_at timestamptz,

  status text DEFAULT 'active' CHECK (status IN ('active', 'invoiced', 'paid', 'failed', 'void')),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(business_id, period_start)
);

CREATE INDEX idx_billing_periods_business ON billing_periods(business_id, period_start);
CREATE INDEX idx_billing_periods_status ON billing_periods(status, period_end);

CREATE TRIGGER billing_periods_updated_at
  BEFORE UPDATE ON billing_periods
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- Booking events: every AI-booked appointment logged here
-- ============================================================
CREATE TABLE booking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) NOT NULL,
  billing_period_id uuid REFERENCES billing_periods(id) NOT NULL,

  appointment_id uuid REFERENCES appointments(id),
  contact_id uuid REFERENCES contacts(id),
  contact_name text,
  service_description text,
  appointment_datetime timestamptz,
  channel text,

  amount_raw numeric(10,2) NOT NULL DEFAULT 20.00,
  amount_billed numeric(10,2) NOT NULL,
  currency text NOT NULL CHECK (currency IN ('GBP', 'USD', 'EUR')),
  capped boolean DEFAULT false,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_booking_events_business ON booking_events(business_id, created_at);
CREATE INDEX idx_booking_events_period ON booking_events(billing_period_id);

-- ============================================================
-- AI takeover queue
-- ============================================================
CREATE TABLE ai_takeover_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) NOT NULL,
  conversation_id uuid REFERENCES conversations(id) NOT NULL,
  trigger_message_id uuid REFERENCES messages(id) NOT NULL,
  channel text NOT NULL,

  message_received_at timestamptz NOT NULL,
  takeover_at timestamptz NOT NULL,
  grace_checked_at timestamptz,

  status text DEFAULT 'pending' CHECK (status IN (
    'pending', 'owner_replied', 'ai_replied', 'cancelled', 'expired'
  )),

  owner_reply_message_id uuid REFERENCES messages(id),
  ai_reply_message_id uuid REFERENCES messages(id),

  created_at timestamptz DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX idx_takeover_pending ON ai_takeover_queue(status, takeover_at)
  WHERE status = 'pending';
CREATE INDEX idx_takeover_business ON ai_takeover_queue(business_id, conversation_id);

-- ============================================================
-- RLS Policies
-- ============================================================
ALTER TABLE billing_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own billing periods" ON billing_periods
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

ALTER TABLE booking_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own booking events" ON booking_events
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

ALTER TABLE ai_takeover_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own takeover queue" ON ai_takeover_queue
  FOR SELECT USING (business_id IN (SELECT public.user_business_ids()));

-- Enable realtime for billing_periods
ALTER PUBLICATION supabase_realtime ADD TABLE billing_periods;
