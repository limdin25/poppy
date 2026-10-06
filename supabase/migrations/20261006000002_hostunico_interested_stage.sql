-- 6 Oct 2026: an Interested stage on the Hostunico owners board (Hugo).
--
-- Interested = a warm lead who is not onboarded yet. Pedro had been filing
-- these under Onboarded (Kenny, Angela), which is the FINAL stage, so their
-- callbacks never fired.
--
-- It is NOT final: is_terminal false, requires_followup true (picking it asks
-- for a callback time, so reminders and the dialler's callbacks fire), and it
-- sits straight after Report sent, before Review call booked, Preparing to
-- onboard and Onboarded. For the dialler (dialer_closed, migration
-- 20261006000001) it is an OPEN stage: false, set here when that column exists.
-- Additive and idempotent.

DO $$
DECLARE
  v_pipeline uuid := 'dadce4ac-90b5-4320-9291-ff6bb1cf89f0';
  v_after int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.wk_pipelines WHERE id = v_pipeline) THEN
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.wk_pipeline_columns WHERE pipeline_id = v_pipeline AND name = 'Interested') THEN
    UPDATE public.wk_pipeline_columns
       SET is_terminal = false, requires_followup = true, archived = false
     WHERE pipeline_id = v_pipeline AND name = 'Interested';
  ELSE
    SELECT position INTO v_after
      FROM public.wk_pipeline_columns
     WHERE pipeline_id = v_pipeline AND name = 'Report sent';
    IF v_after IS NULL THEN
      SELECT COALESCE(MAX(position), -1) INTO v_after FROM public.wk_pipeline_columns WHERE pipeline_id = v_pipeline;
    END IF;

    -- Make room after Report sent. Two steps, because (pipeline_id, position)
    -- is UNIQUE and not deferrable.
    UPDATE public.wk_pipeline_columns
       SET position = position + 1000, sort_order = sort_order + 1
     WHERE pipeline_id = v_pipeline AND position > v_after;
    UPDATE public.wk_pipeline_columns
       SET position = position - 999
     WHERE pipeline_id = v_pipeline AND position > v_after + 1000;

    INSERT INTO public.wk_pipeline_columns
      (pipeline_id, name, colour, position, sort_order, is_default_on_timeout, requires_followup, is_terminal, archived)
    VALUES
      (v_pipeline, 'Interested', '#0D9488', v_after + 1, v_after + 1, false, true, false, false);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'wk_pipeline_columns' AND column_name = 'dialer_closed'
  ) THEN
    EXECUTE 'UPDATE public.wk_pipeline_columns SET dialer_closed = false WHERE pipeline_id = $1 AND name = ''Interested'''
      USING v_pipeline;
  END IF;
END
$$;
