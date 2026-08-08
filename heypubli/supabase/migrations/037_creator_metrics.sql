-- Point-in-time metrics per creator account, so growth is answerable.
--
-- Hugo, 08 Aug 2026: "we should show how many followers, people following etc,
-- how many followers gained, everything we should be tracking."
--
-- Outstand's metrics endpoint only ever returns TODAY's numbers. "Followers
-- gained" is not a field anywhere, it is the difference between two readings,
-- so the readings have to be kept. Nothing can be backfilled: the history
-- starts the first time the capture cron runs, and a number we never captured
-- is gone for good.
create table if not exists creator_metrics_snapshots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  captured_at timestamptz not null default now(),
  followers int,
  following int,
  posts int,
  views int,
  likes int,
  comments int,
  shares int,
  saves int,
  reach int,
  accounts_engaged int,
  total_interactions int
);

-- The overview reads "latest per creator" and "this creator over time", and
-- both are this index.
create index if not exists idx_cms_profile_time
  on creator_metrics_snapshots (profile_id, captured_at desc);

-- Admin-only data, read through the service role. RLS on with no policies is
-- the same shape the rest of the pipeline tables use.
alter table creator_metrics_snapshots enable row level security;

comment on table creator_metrics_snapshots is
  'Twice-daily readings of each creator''s Instagram numbers. Growth is derived by comparing two rows; there is no growth field at the source.';

-- Where the post actually lives, so the overview can link to it. Outstand
-- returns platformPostUrl on a published post and we were throwing it away.
alter table scheduled_posts
  add column if not exists platform_post_url text;
