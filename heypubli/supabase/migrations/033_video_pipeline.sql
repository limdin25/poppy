-- The creator video pipeline. Hugo, 07 Aug 2026: "every account gets two
-- videos per day... everyone gets on the same pipeline of videos in sequence
-- ... every account they have their own color... show me a place where it
-- shows the video and which accounts gonna go for and for me to authorize."
--
-- master_videos is THE sequence: every account walks it from seq 1 at two
-- posts a day, whatever day they joined. creator_video_state pins each
-- account's color (a palette family from the variants factory) and where they
-- are in the sequence. creator_video_renders is the render queue the Mac
-- worker drains (one COLORED unique render per master x creator).

create table if not exists master_videos (
  id uuid primary key default gen_random_uuid(),
  seq int not null unique,
  -- The variants-factory source id (v1..v4 for the originals, m<uuid8> for
  -- uploads). The worker maps it to a local ingested clip.
  source_id text not null,
  title text not null default '',
  -- The Instagram caption every account's copy posts with. Editable on the
  -- approval page; empty is a valid caption for a reel.
  caption text not null default '',
  -- Where the raw uploaded clip lives (storage), null for the four originals
  -- that already live inside the video project.
  source_url text,
  -- What Hugo watches on the approval page.
  preview_url text,
  -- 'failed' = the ingest of an uploaded clip failed three times; the worker
  -- marks it and moves on rather than wedging the whole render queue.
  status text not null default 'preview_rendering'
    check (status in ('preview_rendering', 'pending_approval', 'approved', 'failed')),
  approved_at timestamptz,
  -- The approval receipt, frozen at the moment Hugo clicks: who this went to.
  -- Hugo, 08 Aug 2026: "a little tag of when I'm approving, which accounts
  -- I'm approving for even if it's hundreds, and the time where they're
  -- going out." Times come live from scheduled_posts; the WHO is frozen here.
  approval_snapshot jsonb,
  recipe_version int not null default 8,
  created_at timestamptz not null default now()
);

create table if not exists creator_video_state (
  profile_id uuid primary key references profiles(id) on delete cascade,
  -- One of the variants factory's 14 palette families. Unique among active
  -- creators until all 14 are taken, then least-used.
  color_family text not null,
  -- Minutes added to the two daily base slots so no two accounts in the same
  -- timezone ever post at the same moment. Assigned at enrolment, unique.
  stagger_min int not null,
  -- The next master seq this account should receive.
  next_seq int not null default 1,
  -- The account's permanent look number: the variants factory derives every
  -- visual from (sourceId, variantIndex), so a stable index per creator gives
  -- them one consistent personal look across the whole sequence while staying
  -- distinct from every other account.
  variant_idx int not null default 0,
  enrolled_at timestamptz not null default now()
);

create table if not exists creator_video_renders (
  id uuid primary key default gen_random_uuid(),
  master_id uuid not null references master_videos(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  color_family text not null,
  -- Deterministic from master + profile, so a requeue re-renders the SAME
  -- video (the factory is seed-reproducible by design).
  seed text not null,
  status text not null default 'queued'
    check (status in ('queued', 'rendering', 'ready', 'failed')),
  attempts int not null default 0,
  video_url text,
  error text,
  claimed_at timestamptz,
  rendered_at timestamptz,
  created_at timestamptz not null default now(),
  unique (master_id, profile_id)
);

create index if not exists idx_cvr_status on creator_video_renders (status, created_at);

-- The Mac render worker's dead-man stamp, read by the admin page.
create table if not exists video_pipeline_state (
  id text primary key,
  worker_last_seen timestamptz,
  updated_at timestamptz not null default now()
);
insert into video_pipeline_state (id) values ('default')
  on conflict (id) do nothing;

-- Pipeline posts are counted and audited separately from hand-made ones.
alter table scheduled_posts add column if not exists master_video_id uuid
  references master_videos(id) on delete set null;

-- One post per master per account, EVER, enforced where enforcement is real.
-- Two overlapping cron runs (Vercel retries, a manual curl during the cron
-- minute) would otherwise both pass the in-memory count and double-post.
create unique index if not exists idx_sp_master_profile
  on scheduled_posts (master_video_id, profile_id)
  where master_video_id is not null;

-- scheduled_posts.brand_id is NOT NULL; pipeline posts need an honest brand.
insert into brands (name, is_active, commission_rate)
  select 'HeyPubli', true, 0
  where not exists (select 1 from brands where name = 'HeyPubli');

-- Storage: the live project had ZERO buckets (even the existing /admin
-- scheduler upload code pointed at a bucket that did not exist).
insert into storage.buckets (id, name, public)
  values ('media', 'media', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
  values ('creator-videos', 'creator-videos', true)
  on conflict (id) do nothing;

-- Service-role only (the admin actions and the worker use the service key).
alter table master_videos enable row level security;
alter table creator_video_state enable row level security;
alter table creator_video_renders enable row level security;
alter table video_pipeline_state enable row level security;

-- Storage default caps files at 50MB while a long master at crf 18 can pass
-- 60MB; the render worker's verify allows up to 80.
update storage.buckets set file_size_limit = 209715200
  where id in ('creator-videos', 'media');
