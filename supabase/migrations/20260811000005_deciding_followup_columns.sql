-- Two more disposition columns Hugo asked for on 2026-08-11:
--
--   "can we add more disposition option like deciding so its specific for me
--    and follow up as well? make it live"
--
-- Deciding  = the branch has our interest and is thinking it over.
-- Follow up = warm, ring them again.
--
-- These live next to Ballpark on the same board Hugo watches all day
-- (wk_pipeline_columns, the Default workspace pipeline). Both require a
-- follow-up, exactly like Ballpark, because the whole point of a "still
-- deciding" or "follow up" card is that the board nags until it is chased.
-- The property dialer's Houses tab has matching outcome buttons
-- (PropertiesPane.tsx) and api/crm/property-outcome.ts drops the branch card
-- into the right column when Pedro presses one.
--
-- Same idempotent shift pattern as the Ballpark migration
-- (20260811000001): park the tail out of range via +1000 first, because
-- (pipeline_id, position) is UNIQUE and not deferrable, so a row-by-row
-- "position + 1" collides mid-update. Only the board that actually has both an
-- Interested AND a Voicemail column is touched, never the HeyPubli Creators
-- pipeline.
--
-- Re-run safe.

do $$
declare
  v_pipeline uuid;
  v_after    int;
  v_name     text;
  v_colour   text;
  v_slot     int;
begin
  for v_pipeline in
    select pipeline_id
    from wk_pipeline_columns
    where name = 'Interested'
      and pipeline_id in (select pipeline_id from wk_pipeline_columns where name = 'Voicemail')
  loop
    -- Insert right after Ballpark when it exists, otherwise after Interested,
    -- so the warm states sit together near the top of the board.
    select position into v_after
      from wk_pipeline_columns
     where pipeline_id = v_pipeline and name = 'Ballpark'
     limit 1;
    if v_after is null then
      select position into v_after
        from wk_pipeline_columns
       where pipeline_id = v_pipeline and name = 'Interested'
       limit 1;
    end if;

    v_slot := 0;
    for v_name, v_colour in
      select * from (values ('Deciding', '#7C5CBF'), ('Follow up', '#2F8F9D')) as t(n, c)
    loop
      -- Idempotent: skip a column this board already has.
      if exists (
        select 1 from wk_pipeline_columns
        where pipeline_id = v_pipeline and name = v_name
      ) then
        continue;
      end if;

      -- Make room for one column immediately after the current insert point.
      update wk_pipeline_columns
         set position   = position + 1000,
             sort_order = sort_order + 1000
       where pipeline_id = v_pipeline
         and position > v_after + v_slot;

      insert into wk_pipeline_columns
        (pipeline_id, name, colour, position, sort_order, requires_followup, is_terminal, archived)
      values
        (v_pipeline, v_name, v_colour, v_after + v_slot + 1, v_after + v_slot + 1, true, false, false);

      update wk_pipeline_columns
         set position   = position - 999,
             sort_order = sort_order - 999
       where pipeline_id = v_pipeline
         and position > 1000;

      v_slot := v_slot + 1;
    end loop;
  end loop;
end $$;
