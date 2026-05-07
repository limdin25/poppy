-- ============================================================
-- MIGRATION: Configurable takeover delay + booking disputes
-- ============================================================

-- Takeover delay settings on businesses
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS takeover_delay_seconds integer DEFAULT 1200;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS after_hours_delay_seconds integer DEFAULT 0;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS working_hours_start integer DEFAULT 8;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS working_hours_end integer DEFAULT 18;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS working_days text[] DEFAULT '{Mon,Tue,Wed,Thu,Fri}';

-- Booking disputes / credit requests
CREATE TABLE IF NOT EXISTS booking_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) NOT NULL,
  booking_event_id uuid REFERENCES booking_events(id) NOT NULL,
  reason text NOT NULL CHECK (reason IN ('ai_error', 'wrong_time', 'wrong_service', 'duplicate', 'other')),
  description text,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  credit_amount numeric(10,2),
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_disputes_business ON booking_disputes(business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_booking_disputes_status ON booking_disputes(status) WHERE status = 'pending';

ALTER TABLE booking_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own disputes" ON booking_disputes
  FOR SELECT USING (business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  ));

CREATE POLICY "Users create own disputes" ON booking_disputes
  FOR INSERT WITH CHECK (business_id IN (
    SELECT id FROM businesses WHERE owner_id = auth.uid()
  ));

-- Inactive account tracking
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS channels_paused boolean DEFAULT false;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS channels_paused_at timestamptz;
