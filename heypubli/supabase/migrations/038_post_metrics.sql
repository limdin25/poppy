-- Per-VIDEO numbers: views, likes, reach and the rest, for each post we published.
--
-- Hugo, 08 Aug 2026: "on the video posted we should be able to see a column as
-- well with the numbers of views and likes per video. Isn't that correct?"
--
-- It is correct, and an earlier note in this repo said the opposite. That note
-- was wrong. Outstand DOES serve per-post metrics, at
--   GET /v1/posts/{id}/analytics
-- which returns metrics_by_account[].metrics = {views, likes, comments, shares,
-- saves, reach} plus platform_post_id and platform_post_url. The endpoints that
-- 404 are /metrics and /insights, which is all that had been tried.
--
-- Two places to put the numbers, because they answer different questions:
--   scheduled_posts.*        the CURRENT count, what the page shows in a column
--   post_metrics_snapshots   the HISTORY, so "views in the last 24 hours" for
--                            one video is answerable at all
-- A single current count can never yield a delta, exactly as with creator
-- followers in 037. And as there, nothing can be backfilled: the history starts
-- at the first capture.

alter table scheduled_posts
  add column if not exists views int,
  add column if not exists saves int,
  add column if not exists metrics_captured_at timestamptz;

-- reach, likes, comments and shares already exist on this table. They were
-- added for the old Meta publishing path and were never once written to; the
-- capture now fills them for real.

create table if not exists post_metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references scheduled_posts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  views int,
  likes int,
  comments int,
  shares int,
  saves int,
  reach int
);

-- Every read is "this post over time", newest first.
create index if not exists idx_pms_post_time
  on post_metrics_snapshots (post_id, captured_at desc);

-- Admin-only data reached through the service role, matching the shape the
-- rest of the pipeline tables use: RLS on, no policies.
alter table post_metrics_snapshots enable row level security;

comment on table post_metrics_snapshots is
  'Hourly readings of one published video''s Instagram numbers. Views in the last 24h is the gap between two rows; there is no such field at the source.';

comment on column scheduled_posts.metrics_captured_at is
  'When the views/likes/reach on this row were last read from Outstand. Null means never read, which is not the same as zero.';
