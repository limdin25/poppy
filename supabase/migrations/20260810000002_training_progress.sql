-- Pedro's training page: what he has watched, and how he did on the test.
--
-- Two tables, written ONLY by the service role through api/training/* (the page
-- is PIN-gated, not logged in, so there is no JWT to hang RLS off). Same shape
-- and the same reasoning as the brrr_* tables: admin-only data, no RLS, no
-- anon or authenticated grants, and every read goes through an API route that
-- checks the caller.
--
-- Why coverage and not a "completed" flag: a flag can be fired by a page load,
-- and a percentage taken from video.currentTime can be earned by dragging the
-- scrub bar to the end. watched_sec is the sum of the DECODED ranges
-- (HTMLMediaElement.played), which only grows when frames actually play, and it
-- is written monotonically here as well so a reload cannot lower it. Same
-- lesson the VSL funnel learned the hard way in July, see api/vsl/page.ts.
--
-- Re-run safe.

create table if not exists public.training_video_progress (
  id            uuid primary key default gen_random_uuid(),
  -- Who. The page has no login, so this is a fixed key ('pedro') rather than an
  -- auth.uid(). profile_id is filled in when we know it, purely so Hugo can join
  -- this to the CRM agent later; nothing depends on it being set.
  trainee_key   text not null,
  profile_id    uuid references public.profiles(id) on delete set null,
  video_key     text not null,
  duration_sec  numeric(10,2),
  -- Unique seconds of video actually decoded. Monotonic.
  watched_sec   numeric(10,2) not null default 0,
  pct           int not null default 0,
  -- How many times he pressed play, and how many separate sittings. Useful
  -- context for Hugo: "100% in one go" reads differently from "100% over nine".
  play_count    int not null default 0,
  first_seen_at timestamptz not null default now(),
  completed_at  timestamptz,
  updated_at    timestamptz not null default now(),
  unique (trainee_key, video_key)
);

create index if not exists training_video_progress_trainee_idx
  on public.training_video_progress (trainee_key);

create table if not exists public.training_quiz_attempts (
  id            uuid primary key default gen_random_uuid(),
  trainee_key   text not null,
  profile_id    uuid references public.profiles(id) on delete set null,
  status        text not null default 'in_progress',   -- in_progress | submitted | abandoned
  -- The questions THIS attempt was served, in the order served, with the option
  -- order used. Stored on start so grading happens against what he actually saw
  -- and so the correct answers never have to travel to the browser first.
  served        jsonb not null default '[]',
  -- One row per question after submission: what he picked, what was right,
  -- whether it timed out.
  results       jsonb not null default '[]',
  score         int,
  total         int,
  pct           int,
  passed        boolean,
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  duration_sec  int,
  updated_at    timestamptz not null default now()
);

create index if not exists training_quiz_attempts_trainee_idx
  on public.training_quiz_attempts (trainee_key, started_at desc);

do $$ begin
  alter table public.training_quiz_attempts
    add constraint training_quiz_attempts_status_chk
    check (status in ('in_progress', 'submitted', 'abandoned'));
exception when duplicate_object then null;
end $$;

-- Belt and braces: these hold nothing sensitive, but they are admin tables and
-- there is no reason for a logged-in client of the product to be able to read
-- them. RLS on with no policies = service role only.
alter table public.training_video_progress enable row level security;
alter table public.training_quiz_attempts  enable row level security;

comment on table public.training_video_progress is
  'Per-video watch coverage for the PIN-gated /pedro-training page. watched_sec is summed HTMLMediaElement.played ranges, not the playhead, so seeking ahead earns nothing.';
comment on table public.training_quiz_attempts is
  'One row per quiz attempt on /pedro-training. served holds the questions and option order that attempt was given; grading is server side against api/lib/training-questions.ts.';
