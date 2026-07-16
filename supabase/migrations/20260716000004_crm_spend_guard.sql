-- C2 fix — wire the kill switch + a daily SMS cap into every outbound SMS path.
-- Before this, wk_check_spend/wk_killswitches were consulted ONLY by the voice
-- dialer, so a kill-switch flip stopped calls but not broadcasts / warm-up SMS /
-- AI replies, and there was no ceiling on SMS volume. This adds a single gate
-- (wk_outbound_sms_allowed) that the SMS send paths call before spending.

-- ── Adjustable send limits (singleton) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_send_limits (
  id             text PRIMARY KEY DEFAULT 'default',
  daily_sms_cap  integer,          -- NULL = unlimited; default 5000/day
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wk_send_limits_singleton CHECK (id = 'default')
);
INSERT INTO wk_send_limits (id, daily_sms_cap) VALUES ('default', 5000)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE wk_send_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wk_send_limits_admin_all ON wk_send_limits;
CREATE POLICY wk_send_limits_admin_all ON wk_send_limits
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());
DROP POLICY IF EXISTS wk_send_limits_agent_read ON wk_send_limits;
CREATE POLICY wk_send_limits_agent_read ON wk_send_limits
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());

-- ── The gate: global kill switch + daily outbound-SMS volume cap ─────────────
CREATE OR REPLACE FUNCTION wk_outbound_sms_allowed()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_killed boolean;
  v_cap    integer;
  v_sent   integer;
BEGIN
  -- Global emergency stop. Reuses the existing 'outbound' / 'all_dialers'
  -- kill switches (scope_agent_id IS NULL = whole workspace).
  SELECT EXISTS (
    SELECT 1 FROM wk_killswitches
     WHERE is_active = true
       AND kind IN ('outbound', 'all_dialers')
       AND scope_agent_id IS NULL
  ) INTO v_killed;
  IF v_killed THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'killswitch');
  END IF;

  SELECT daily_sms_cap INTO v_cap FROM wk_send_limits WHERE id = 'default';
  IF v_cap IS NULL THEN
    RETURN jsonb_build_object('allowed', true, 'reason', 'no_cap');
  END IF;

  -- Count today's real outbound sends (drafts don't consume the cap).
  SELECT count(*) INTO v_sent
    FROM wk_sms_messages
   WHERE direction = 'outbound'
     AND status <> 'draft'
     AND created_at >= date_trunc('day', now());

  IF v_sent >= v_cap THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'daily_cap',
                              'sent_today', v_sent, 'cap', v_cap);
  END IF;
  RETURN jsonb_build_object('allowed', true, 'reason', 'within_cap',
                            'sent_today', v_sent, 'cap', v_cap);
END;
$$;

GRANT EXECUTE ON FUNCTION wk_outbound_sms_allowed() TO authenticated, service_role;
