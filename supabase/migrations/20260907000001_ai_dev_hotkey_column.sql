-- AI_DEV_HOTKEY disposition column (Hugo, 2026-09-07).
--
-- A new post-call disposition and matching pipeline column on the property
-- board (the one with both Interested and Voicemail). The property dialer's
-- Houses tab outcome button and api/crm/property-outcome.ts drop the branch
-- card here when Pedro presses it.
--
-- Idempotent. Same +1000 shift pattern as 20260811000005_deciding_followup_columns.sql
-- because (pipeline_id, position) is UNIQUE and not deferrable.

do $$
declare
  v_pipeline uuid;
  v_after    int;
begin
  for v_pipeline in
    select pipeline_id
    from wk_pipeline_columns
    where name = 'Interested'
      and pipeline_id in (select pipeline_id from wk_pipeline_columns where name = 'Voicemail')
  loop
    if exists (
      select 1 from wk_pipeline_columns
      where pipeline_id = v_pipeline and name = 'AI_DEV_HOTKEY'
    ) then
      continue;
    end if;

    select position into v_after
      from wk_pipeline_columns
     where pipeline_id = v_pipeline and name = 'Follow up'
     limit 1;
    if v_after is null then
      select position into v_after
        from wk_pipeline_columns
       where pipeline_id = v_pipeline and name = 'Ballpark agreed'
       limit 1;
    end if;
    if v_after is null then
      select position into v_after
        from wk_pipeline_columns
       where pipeline_id = v_pipeline and name = 'Interested'
       limit 1;
    end if;

    update wk_pipeline_columns
       set position   = position + 1000,
           sort_order = sort_order + 1000
     where pipeline_id = v_pipeline
       and position > v_after;

    insert into wk_pipeline_columns
      (pipeline_id, name, colour, position, sort_order, requires_followup, is_terminal, archived)
    values
      (v_pipeline, 'AI_DEV_HOTKEY', '#6366F1', v_after + 1, v_after + 1, false, false, false);

    update wk_pipeline_columns
       set position   = position - 999,
           sort_order = sort_order - 999
     where pipeline_id = v_pipeline
       and position > 1000;
  end loop;
end $$;
