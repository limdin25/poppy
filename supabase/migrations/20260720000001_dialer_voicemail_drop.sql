-- Voicemail drop for the CRM speed dialer (agent-pressed drop).
-- Idempotent. RLS is already enabled on both tables via the crm_port
-- enable-loop (20260715000001_crm_port.sql:2070+); new columns inherit the
-- existing policies.

-- Per-campaign voicemail drop config
ALTER TABLE wk_dialer_campaigns
  ADD COLUMN IF NOT EXISTS voicemail_recording_url text,
  ADD COLUMN IF NOT EXISTS voicemail_drop_enabled  boolean NOT NULL DEFAULT false;

-- Per-call: was a drop played. Orthogonal to status on purpose —
-- status='voicemail' means "AMD detected a machine" and is bucketed as
-- answered in reports; an agent-pressed drop is a separate concept and
-- must not skew answer-rate math.
ALTER TABLE wk_calls
  ADD COLUMN IF NOT EXISTS voicemail_dropped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS voicemail_dropped_at timestamptz;
