-- ────────────────────────────────────────────────────────────────────────────
-- CRM Growth · Phase A — Mass SMS (broadcasts)
-- Adds wk_broadcasts (one row per blast) + a broadcast_id link on messages so
-- the CRM can show live progress + full history. Recipients are enqueued as
-- ordinary wk_jobs send_sms rows (staggered scheduled_for), so the existing
-- worker sends + logs them; this migration only adds the tracking surface.
-- Idempotent / re-runnable.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wk_broadcasts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL DEFAULT '',
  channel        text NOT NULL DEFAULT 'sms'
    CONSTRAINT wk_broadcasts_channel_chk CHECK (channel IN ('sms', 'whatsapp', 'email')),
  template_body  text NOT NULL DEFAULT '',
  from_e164      text,
  filter         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {contact_ids?|tags?|stage_id?|all?}
  throttle_seconds integer NOT NULL DEFAULT 3,
  total          integer NOT NULL DEFAULT 0,
  sent           integer NOT NULL DEFAULT 0,
  failed         integer NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'sending'
    CONSTRAINT wk_broadcasts_status_chk CHECK (status IN ('sending', 'done', 'cancelled')),
  created_by     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Link each sent message back to its broadcast (nullable — normal 1:1 sends stay NULL).
ALTER TABLE wk_sms_messages
  ADD COLUMN IF NOT EXISTS broadcast_id uuid REFERENCES wk_broadcasts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS wk_sms_messages_broadcast_idx
  ON wk_sms_messages (broadcast_id) WHERE broadcast_id IS NOT NULL;

-- updated_at trigger (reuse the shared helper defined in the base migration).
DROP TRIGGER IF EXISTS wk_broadcasts_set_updated_at ON wk_broadcasts;
CREATE TRIGGER wk_broadcasts_set_updated_at
  BEFORE UPDATE ON wk_broadcasts
  FOR EACH ROW EXECUTE FUNCTION wk_set_updated_at();

-- Atomic counter bump used by the jobs worker after each send (avoids races
-- across the batch). Marks the broadcast 'done' once sent+failed reaches total.
CREATE OR REPLACE FUNCTION wk_broadcast_tally(p_broadcast_id uuid, p_sent int, p_failed int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE wk_broadcasts
     SET sent = sent + GREATEST(p_sent, 0),
         failed = failed + GREATEST(p_failed, 0),
         updated_at = now()
   WHERE id = p_broadcast_id;
  UPDATE wk_broadcasts
     SET status = 'done', updated_at = now()
   WHERE id = p_broadcast_id AND status = 'sending' AND (sent + failed) >= total;
END;
$$;
REVOKE EXECUTE ON FUNCTION wk_broadcast_tally(uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION wk_broadcast_tally(uuid, int, int) TO service_role;

-- RLS: agents + admins read; writes go through the edge function (service role)
-- and the tally RPC. Mirrors the wk_* agent-read / admin-all pattern.
ALTER TABLE wk_broadcasts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wk_broadcasts_read ON wk_broadcasts;
CREATE POLICY wk_broadcasts_read ON wk_broadcasts
  FOR SELECT TO authenticated
  USING (wk_is_agent_or_admin());

DROP POLICY IF EXISTS wk_broadcasts_admin_all ON wk_broadcasts;
CREATE POLICY wk_broadcasts_admin_all ON wk_broadcasts
  FOR ALL TO authenticated
  USING (wk_is_admin())
  WITH CHECK (wk_is_admin());

-- Realtime so the Broadcasts UI shows live sent/total without polling.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wk_broadcasts'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE wk_broadcasts';
  END IF;
END $$;
