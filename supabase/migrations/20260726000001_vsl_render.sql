-- VSL render pipeline (Hugo 2026-07-26): the video factory's DB surface.
-- Render lifecycle lives in its OWN columns — the funnel `state` machine and
-- wk_vsl_advance are untouched. Re-run safe throughout.

-- ============ render columns on wk_vsl_pages ============
alter table wk_vsl_pages
  add column if not exists render_status text
    check (render_status in ('queued', 'rendering', 'ready', 'failed')),
  add column if not exists render_error text,
  add column if not exists render_requested_at timestamptz,
  add column if not exists render_started_at timestamptz,
  add column if not exists render_done_at timestamptz,
  add column if not exists poster_url text,
  add column if not exists no_website boolean not null default false;

-- Worker claim scans by status + age.
create index if not exists wk_vsl_pages_render_queue_idx
  on wk_vsl_pages (render_status, render_requested_at)
  where render_status is not null;

-- ============ two review columns before "Video sent" ============
-- Rendering → Ready to send sit directly in front of the six funnel columns
-- so a card walks the whole journey left→right on the existing board.
do $$
declare
  pid uuid;
  vs_pos int;
begin
  select id into pid from wk_pipelines order by created_at limit 1;
  if pid is null then return; end if;

  if exists (
    select 1 from wk_pipeline_columns c
    where c.pipeline_id = pid and c.name in ('Rendering', 'Ready to send')
  ) then return; end if;

  select position into vs_pos from wk_pipeline_columns
    where pipeline_id = pid and name = 'Video sent';
  if vs_pos is null then
    -- funnel columns missing (migration 1 skipped) — append at the end instead
    select coalesce(max(position), -1) + 1 into vs_pos from wk_pipeline_columns where pipeline_id = pid;
  else
    -- Two-step shift: (pipeline_id, position) is UNIQUE and Postgres checks
    -- per-row, so a direct +2 collides with the neighbour. Jump the block far
    -- above every real position, then bring it back down to +2.
    update wk_pipeline_columns
      set position = position + 1002, sort_order = sort_order + 1002
      where pipeline_id = pid and position >= vs_pos;
    update wk_pipeline_columns
      set position = position - 1000, sort_order = sort_order - 1000
      where pipeline_id = pid and position >= 1000;
  end if;

  insert into wk_pipeline_columns (pipeline_id, name, colour, position, sort_order, is_terminal)
  values
    (pid, 'Rendering',     '#94A3B8', vs_pos,     vs_pos,     false),
    (pid, 'Ready to send', '#64748B', vs_pos + 1, vs_pos + 1, false);
end $$;
