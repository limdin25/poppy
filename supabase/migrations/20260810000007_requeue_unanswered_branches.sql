-- An office that did not pick up goes to the BACK of the list, five times.
--
-- Hugo, 2026-08-10: "the offices that didn't pick up, they should go to the end
-- of the list, okay? About five times."
--
-- WHY THIS WAS NOT ALREADY HAPPENING. wk_apply_outcome marks the queue row
-- 'done' for EVERY outcome, so a voicemail buried the branch exactly as
-- thoroughly as "not interested" did. On Pedro's first day all 56 of his queue
-- rows finished at attempts = 1: not one branch was ever dialled twice, and 31
-- offices that never spoke to a human were written off after a single ring.
--
-- THE HARD PART IS NOT THE REQUEUE, IT IS KNOWING NOBODY ANSWERED. There is no
-- answering-machine detection in our TwiML, so Twilio reports `completed` with
-- answered_by NULL when a branch's voicemail picks up: 52 of his 55 calls came
-- back that way. The only reliable signal is the outcome the agent pressed. So
-- the trigger is the COLUMN, and the columns that mean "no human" are Voicemail
-- and No pickup, matched by name so a renamed or re-seeded pipeline still works.
--
-- HOW "THE BACK OF THE LIST" IS EXPRESSED. wk_dialer_queue has no position
-- column. Order is priority DESC, scheduled_for ASC NULLS FIRST, attempts ASC,
-- created_at ASC. So a requeued row gets its priority dropped below every
-- waiting row AND a scheduled_for in the future, which does two jobs at once:
-- it puts the branch behind fresh stock, and it stops us ringing the same
-- office twice in the same hour. That spacing used to exist in the AI cron
-- ("never ring the same office twice within 30 minutes", deleted with the
-- robot in 173406c) and has protected nothing since.
--
-- FIVE ATTEMPTS THEN STOP. attempts already increments in wk_claim_queue_row
-- and, until now, was read by nothing except a sort tiebreaker. On the fifth
-- unanswered try the row goes to 'lost', which is the same terminal state
-- wk_dialer_strike_losers uses, so nothing new has to learn about it.

-- How long a branch rests before it comes round again. Two hours matches the
-- retired cron's retry_hours and keeps a five-attempt branch spread across a
-- working day rather than rung five times before lunch.
CREATE OR REPLACE FUNCTION wk_requeue_gap_minutes()
RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT 120 $$;

CREATE OR REPLACE FUNCTION wk_apply_outcome(
  p_call_id      uuid,
  p_contact_id   uuid,
  p_column_id    uuid,
  p_agent_note   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    UPDATE wk_contacts
       SET pipeline_column_id = p_column_id,
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
$$;

COMMENT ON FUNCTION wk_apply_outcome(uuid, uuid, uuid, text) IS
  'Applies a call outcome. Voicemail / No pickup send the branch to the BACK of the queue with a rest gap, up to 5 attempts, then lost. Every other outcome closes the row as before.';
