-- The hook bank: the three beats of text that open every video.
--
-- Hugo, 26 Aug 2026: "it has to always use the AI to generate a new text... the
-- beginning has to be always unique as well." Calling a model per post would be
-- 3,700 calls a day for no gain and no chance to read anything before it goes
-- out. Instead a writer tops this table up in batches, Hugo can read what is in
-- it, and the draw guarantees no account ever gets the same hook twice.
--
-- Two tables because those are two different facts: what exists to say, and who
-- has already said it.

create table if not exists hook_lines (
  id          uuid primary key default gen_random_uuid(),
  -- one beat per column, each holding one or two short lines separated by \n
  beat1       text not null,
  beat2       text not null,
  beat3       text not null,
  -- so a bad batch can be pulled without deleting the history of what was used
  retired_at  timestamptz,
  created_at  timestamptz not null default now()
);

-- The same three beats must never enter the bank twice, however many times the
-- writer runs. Without this a model that likes one phrasing quietly fills the
-- bank with near-duplicates and the "always unique" promise is only true of the
-- row id.
create unique index if not exists hook_lines_unique
  on hook_lines (md5(lower(beat1 || '|' || beat2 || '|' || beat3)));

create index if not exists hook_lines_live on hook_lines (created_at)
  where retired_at is null;

create table if not exists hook_uses (
  profile_id  uuid not null references profiles (id) on delete cascade,
  hook_id     uuid not null references hook_lines (id) on delete cascade,
  used_at     timestamptz not null default now(),
  primary key (profile_id, hook_id)
);

-- The draw asks "what has this account not used yet", every time, for every
-- post. At fifty a day across 74 accounts that is the hottest read in the
-- machine.
create index if not exists hook_uses_by_profile on hook_uses (profile_id, used_at desc);

alter table hook_lines enable row level security;
alter table hook_uses  enable row level security;

-- No policies on purpose: only the service role writes or reads these, from the
-- cron and the render worker. RLS on with no policy is a closed door, which is
-- the right default for a table no browser ever needs to touch.
