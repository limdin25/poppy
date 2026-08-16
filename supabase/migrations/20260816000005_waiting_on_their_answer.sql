-- "Waiting on their answer": the column a branch card moves to when WE have
-- replied in writing and the ball is in their court.
--
-- Hugo, 2026-08-16, on DDM: "So I replied it. So why still on the list if you
-- replied? It should go to a pipeline, replied and waiting if they come back
-- to us." The cockpit's send_email press moves the card here (from Offer sent
-- or Nurturing), the cockpit filter keeps it off the desk until the branch
-- writes back or four days of silence pass, and the board says where the deal
-- really is.
--
-- Property pipeline only: found as the board that owns 'Ballpark agreed', the
-- same anchor api/crm/cockpit.ts uses, so the HeyPubli creators board is never
-- touched. Inserted right after 'Offer sent', where it belongs in the story.
--
-- Same idempotent shift pattern as 20260811000005: park the tail out of range
-- via +1000 first, because (pipeline_id, position) is UNIQUE and not
-- deferrable, so a row-by-row "position + 1" collides mid-update.
--
-- requires_followup stays FALSE on purpose: waiting on them is not our
-- appointment, and a forced follow-up here would make the cockpit read the
-- card as 'scheduled' instead of 'waiting on their answer'.
--
-- Re-run safe.

do $$
declare
  v_pipeline uuid;
  v_after    int;
  v_sort     int;
begin
  select pipeline_id into v_pipeline
    from wk_pipeline_columns
   where name = 'Ballpark agreed'
   limit 1;
  if v_pipeline is null then
    return;
  end if;

  if exists (
    select 1 from wk_pipeline_columns
    where pipeline_id = v_pipeline and name = 'Waiting on their answer'
  ) then
    return;
  end if;

  -- position and sort_order are NOT the same number on this board (Offer sent
  -- is position 6, sort_order 5), so each gets its own anchor.
  select position, sort_order into v_after, v_sort
    from wk_pipeline_columns
   where pipeline_id = v_pipeline and name = 'Offer sent'
   limit 1;
  if v_after is null then
    select max(position), max(sort_order) into v_after, v_sort
      from wk_pipeline_columns
     where pipeline_id = v_pipeline;
  end if;

  update wk_pipeline_columns
     set position = position + 1000
   where pipeline_id = v_pipeline
     and position > v_after;
  update wk_pipeline_columns
     set sort_order = sort_order + 1000
   where pipeline_id = v_pipeline
     and sort_order > v_sort;

  insert into wk_pipeline_columns
    (pipeline_id, name, colour, position, sort_order, requires_followup, is_terminal, archived)
  values
    (v_pipeline, 'Waiting on their answer', '#D97706', v_after + 1, v_sort + 1, false, false, false);

  update wk_pipeline_columns
     set position = position - 999
   where pipeline_id = v_pipeline
     and position > 1000;
  update wk_pipeline_columns
     set sort_order = sort_order - 999
   where pipeline_id = v_pipeline
     and sort_order > 1000;
end $$;
