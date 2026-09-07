-- AI_DEV_HOTKEY disposition column (Hugo, 2026-09-07).
--
-- A new post-call disposition and matching pipeline column on the property
-- board (found as the pipeline that owns 'Ballpark agreed', same anchor as
-- api/crm/cockpit.ts). The property dialer's Houses tab outcome button and
-- api/crm/property-outcome.ts drop the branch card here when Pedro presses it.
--
-- Idempotent. Same +1000 shift pattern as 20260816000005_waiting_on_their_answer.sql
-- because (pipeline_id, position) is UNIQUE and not deferrable.

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
    where pipeline_id = v_pipeline and name = 'AI_DEV_HOTKEY'
  ) then
    return;
  end if;

  select position, sort_order into v_after, v_sort
    from wk_pipeline_columns
   where pipeline_id = v_pipeline and name = 'Follow up'
   limit 1;
  if v_after is null then
    select position, sort_order into v_after, v_sort
      from wk_pipeline_columns
     where pipeline_id = v_pipeline and name = 'Ballpark agreed'
     limit 1;
  end if;
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
    (v_pipeline, 'AI_DEV_HOTKEY', '#6366F1', v_after + 1, v_sort + 1, false, false, false);

  update wk_pipeline_columns
     set position = position - 999
   where pipeline_id = v_pipeline
     and position > 1000;
  update wk_pipeline_columns
     set sort_order = sort_order - 999
   where pipeline_id = v_pipeline
     and sort_order > 1000;
end $$;
