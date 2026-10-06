-- 6 Oct 2026: the dialler served contacts Pedro had already worked.
--
-- Ace Homes went to Report sent and had a call follow-up booked for 6 Oct
-- 17:00, but its queue row from an earlier voicemail stayed pending, so the
-- dialler served it at 11:44, five hours early. Nothing in the queue looked at
-- the contact's stage or its follow-ups.
--
-- The fix filters at PICK time, never by rewriting queue rows:
-- 1. wk_pipeline_columns.dialer_closed marks a worked stage (set on the
--    Hostunico pipeline only, everything else defaults to false).
-- 2. wk_contact_dialer_servable() is the single source of truth: a contact in a
--    dialer_closed column is servable only while a pending call follow-up
--    (wk_contact_followups) is due.
-- 3. wk_pick_next_lead and wk_claim_queue_row both ask it. The client queue
--    asks wk_dialer_servable_contacts() so the list matches the server.
-- 4. wk_apply_outcome keeps a worked stage when a follow-up call goes to
--    voicemail or no pickup, instead of demoting it to Voicemail.
-- Additive and idempotent.

ALTER TABLE public.wk_pipeline_columns
  ADD COLUMN IF NOT EXISTS dialer_closed boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.wk_pipeline_columns.dialer_closed IS
  'A contact in this column has been worked and the next-lead queue skips it unless a call follow-up is due.';

UPDATE public.wk_pipeline_columns
   SET dialer_closed = true
 WHERE pipeline_id = 'dadce4ac-90b5-4320-9291-ff6bb1cf89f0'
   AND name IN ('Report requested','Report sent','Review call booked','Preparing to onboard',
                'Onboarded','Not interested','Do not contact','Cold')
   AND dialer_closed = false;

CREATE OR REPLACE FUNCTION public.wk_contact_dialer_servable(p_contact uuid, p_at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT COALESCE((
      SELECT pc.dialer_closed
        FROM wk_contacts c
        JOIN wk_pipeline_columns pc ON pc.id = c.pipeline_column_id
       WHERE c.id = p_contact
    ), false) THEN true
    ELSE EXISTS (
      SELECT 1
        FROM wk_contact_followups f
       WHERE f.contact_id = p_contact
         AND f.status = 'pending'
         AND f.due_at <= p_at
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.wk_contact_dialer_servable(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wk_contact_dialer_servable(uuid, timestamptz) TO authenticated, service_role;

-- One round trip for the dialler's visible queue: which of these contacts may
-- be served right now.
CREATE OR REPLACE FUNCTION public.wk_dialer_servable_contacts(p_contact_ids uuid[])
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    IF NOT wk_is_agent_or_admin() THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  RETURN QUERY
  SELECT DISTINCT u.id
    FROM unnest(p_contact_ids) AS u(id)
   WHERE u.id IS NOT NULL
     AND wk_contact_dialer_servable(u.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.wk_dialer_servable_contacts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wk_dialer_servable_contacts(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.wk_pick_next_lead(p_agent_id uuid, p_campaign_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(queue_id uuid, contact_id uuid, campaign_id uuid, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Guard: service_role (edge functions) passes; end users must be
  -- workspace agents/admins and may only pick for themselves.
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    IF NOT wk_is_agent_or_admin() THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    IF NOT (p_agent_id = auth.uid() OR wk_is_admin()) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT id
      FROM wk_dialer_queue q
     WHERE q.status = 'pending'
       AND (p_campaign_id IS NULL OR q.campaign_id = p_campaign_id)
       AND (q.scheduled_for IS NULL OR q.scheduled_for <= now())
       AND (q.agent_id = p_agent_id OR q.agent_id IS NULL)
       -- 2026-10-06: skip worked contacts unless a call follow-up is due.
       AND wk_contact_dialer_servable(q.contact_id)
     ORDER BY q.priority DESC NULLS LAST,
              q.scheduled_for ASC NULLS FIRST,
              q.attempts ASC,
              q.created_at ASC
     LIMIT 1
     FOR UPDATE SKIP LOCKED
  )
  UPDATE wk_dialer_queue q
     SET status   = 'dialing',
         agent_id = p_agent_id,
         attempts = q.attempts + 1
   FROM picked p
   WHERE q.id = p.id
   RETURNING q.id, q.contact_id, q.campaign_id, q.attempts;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wk_claim_queue_row(p_queue_id uuid, p_agent_id uuid)
 RETURNS TABLE(queue_id uuid, contact_id uuid, campaign_id uuid, attempts integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Guard: service_role (edge functions) passes; end users must be
  -- workspace agents/admins and may only claim for themselves.
  IF COALESCE(auth.role(), 'service_role') <> 'service_role' THEN
    IF NOT wk_is_agent_or_admin() THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    IF NOT (p_agent_id = auth.uid() OR wk_is_admin()) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
  END IF;

  RETURN QUERY
  UPDATE wk_dialer_queue q
     SET status   = 'dialing',
         agent_id = p_agent_id,
         attempts = q.attempts + 1
   WHERE q.id = p_queue_id
     AND q.status = 'pending'
     -- 2026-10-06: a worked contact is not claimable from the queue unless a
     -- call follow-up is due. Priority 9999 is the mark the dialler puts on a
     -- row when Pedro deliberately rings that one contact (board Call button,
     -- Redial, column dial), and that is still allowed.
     AND (q.priority >= 9999 OR wk_contact_dialer_servable(q.contact_id))
   RETURNING q.id, q.contact_id, q.campaign_id, q.attempts;
END;
$function$;

CREATE OR REPLACE FUNCTION public.wk_apply_outcome(p_call_id uuid, p_contact_id uuid, p_column_id uuid, p_agent_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_auto record;
  v_applied text[] := ARRAY[]::text[];
  v_template_body text;
  v_contact_name text;
  v_is_terminal boolean := false;
  v_campaign_id uuid;
  v_column_name text;
  v_no_answer boolean := false;
  v_attempts int;
  v_queue_id uuid;
  v_min_priority int;
  v_current_closed boolean := false;
BEGIN
  IF NOT wk_is_admin() THEN
    IF NOT EXISTS (SELECT 1 FROM wk_calls WHERE id = p_call_id AND agent_id = v_actor) THEN
      RAISE EXCEPTION 'forbidden: not your call';
    END IF;
  END IF;

  SELECT is_terminal, name INTO v_is_terminal, v_column_name
    FROM wk_pipeline_columns WHERE id = p_column_id;

  -- "Nobody human spoke to us." Matched on the column NAME rather than a pinned
  -- uuid so a re-seeded pipeline keeps working. Deliberately narrow: Not
  -- interested is a real answer from a real person and must still bury the row.
  v_no_answer := lower(coalesce(v_column_name, '')) IN ('voicemail', 'no pickup', 'no answer');

  -- Capture the campaign so the queue UPDATE below can scope to it.
  SELECT campaign_id INTO v_campaign_id
    FROM wk_calls WHERE id = p_call_id;

  UPDATE wk_calls
     SET disposition_column_id = p_column_id,
         agent_note            = COALESCE(p_agent_note, agent_note)
   WHERE id = p_call_id;

  IF p_contact_id IS NOT NULL THEN
    -- 2026-10-06: a contact already worked (Report sent, Not interested and so
    -- on) who does not pick up on a follow-up call keeps its stage. Demoting it
    -- to Voicemail put it back in the queue like a fresh lead.
    SELECT COALESCE(pc.dialer_closed, false) INTO v_current_closed
      FROM wk_contacts c
      LEFT JOIN wk_pipeline_columns pc ON pc.id = c.pipeline_column_id
     WHERE c.id = p_contact_id;

    UPDATE wk_contacts
       SET pipeline_column_id = CASE WHEN v_no_answer AND COALESCE(v_current_closed, false)
                                     THEN pipeline_column_id ELSE p_column_id END,
           last_contact_at = now(),
           updated_at = now()
     WHERE id = p_contact_id;
  END IF;

  IF p_contact_id IS NOT NULL THEN
    IF v_no_answer THEN
      -- Nobody answered. Send the branch to the back rather than burying it.
      --
      -- UPDATE the existing row, never INSERT a second one: wk_dialer_queue has
      -- NO unique constraint on (campaign_id, contact_id), and
      -- QueueManagerPro's "add to queue" does a .maybeSingle() lookup that
      -- throws the moment a contact holds two rows in one campaign. Requeue by
      -- insert would manufacture exactly that.
      SELECT id, attempts INTO v_queue_id, v_attempts
        FROM wk_dialer_queue
       WHERE contact_id = p_contact_id
         AND (v_campaign_id IS NULL OR campaign_id = v_campaign_id)
         AND status IN ('pending', 'dialing', 'connected', 'voicemail', 'missed')
       ORDER BY CASE status WHEN 'dialing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                attempts DESC
       LIMIT 1;

      IF v_queue_id IS NOT NULL THEN
        IF COALESCE(v_attempts, 0) >= 5 THEN
          UPDATE wk_dialer_queue
             SET status = 'lost', agent_id = NULL
           WHERE id = v_queue_id;
          v_applied := array_append(v_applied, 'queue_lost_after_5_attempts');
        ELSE
          -- Below everything currently waiting, and not before the gap is up.
          SELECT COALESCE(MIN(priority), 0) INTO v_min_priority
            FROM wk_dialer_queue
           WHERE campaign_id = (SELECT campaign_id FROM wk_dialer_queue WHERE id = v_queue_id)
             AND status = 'pending';

          UPDATE wk_dialer_queue
             SET status        = 'pending',
                 agent_id      = NULL,
                 priority      = LEAST(COALESCE(v_min_priority, 0) - 1, COALESCE(priority, 0) - 1),
                 scheduled_for = now() + make_interval(mins => wk_requeue_gap_minutes()),
                 last_attempt_at = now()
           WHERE id = v_queue_id;
          v_applied := array_append(v_applied, 'queue_requeued_to_back');
        END IF;
      END IF;

      -- Any OTHER rows for this contact still close, so a duplicate cannot
      -- resurrect the branch twice over.
      UPDATE wk_dialer_queue
         SET status = 'done', agent_id = NULL
       WHERE contact_id = p_contact_id
         AND id IS DISTINCT FROM v_queue_id
         AND status IN ('pending', 'dialing', 'connected', 'voicemail')
         AND (v_campaign_id IS NULL OR campaign_id = v_campaign_id);
    ELSE
      -- Somebody actually spoke to us. Close it, exactly as before.
      UPDATE wk_dialer_queue
         SET status = 'done',
             agent_id = NULL
       WHERE contact_id = p_contact_id
         AND status IN ('pending', 'dialing', 'connected', 'voicemail')
         AND (v_campaign_id IS NULL OR campaign_id = v_campaign_id);
      v_applied := array_append(v_applied, 'queue_marked_done');
    END IF;
  END IF;

  INSERT INTO wk_activities (contact_id, agent_id, call_id, kind, title, meta)
  VALUES (p_contact_id, v_actor, p_call_id, 'outcome_applied',
          'Outcome applied',
          jsonb_build_object('column_id', p_column_id, 'note', p_agent_note));

  SELECT * INTO v_auto FROM wk_pipeline_automations WHERE column_id = p_column_id;

  IF FOUND AND v_auto.sms_template_id IS NOT NULL AND p_contact_id IS NOT NULL THEN
    SELECT body INTO v_template_body FROM wk_sms_templates WHERE id = v_auto.sms_template_id;
    SELECT name INTO v_contact_name FROM wk_contacts WHERE id = p_contact_id;
    IF v_template_body IS NOT NULL THEN
      INSERT INTO wk_jobs (kind, payload, run_at)
      VALUES ('send_sms',
              jsonb_build_object('contact_id', p_contact_id,
                                 'body', replace(v_template_body, '{{name}}', COALESCE(v_contact_name, ''))),
              now());
      v_applied := array_append(v_applied, 'sms_queued');
    END IF;
  END IF;

  -- retry_dial only fires for NON-terminal columns.
  IF FOUND AND v_auto.retry_dial AND v_auto.retry_in_hours IS NOT NULL AND p_contact_id IS NOT NULL
     AND NOT COALESCE(v_is_terminal, false) THEN
    INSERT INTO wk_dialer_queue (campaign_id, contact_id, status, scheduled_for, priority)
    SELECT campaign_id, p_contact_id, 'pending',
           now() + make_interval(hours => v_auto.retry_in_hours), 5
      FROM wk_calls WHERE id = p_call_id AND campaign_id IS NOT NULL;
    v_applied := array_append(v_applied, 'retry_queued');
  END IF;

  RETURN jsonb_build_object('ok', true, 'applied', v_applied);
END;
$function$;

-- Grants on the three replaced functions are unchanged by CREATE OR REPLACE;
-- restated so a fresh database ends up the same.
REVOKE ALL ON FUNCTION public.wk_pick_next_lead(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wk_pick_next_lead(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.wk_claim_queue_row(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wk_claim_queue_row(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.wk_apply_outcome(uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wk_apply_outcome(uuid, uuid, uuid, text) TO authenticated, service_role;
