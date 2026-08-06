-- 025: the gated onboarding funnel and its nudge brain.
--
-- Hugo, 2026-08-06: the brochure stops being a standalone page and becomes THE
-- onboarding. One step on screen at a time, each tick timestamped, and a brain
-- that messages whoever goes quiet. "We should be tracking everything... we
-- have a system that tracks back and forth."
--
-- Three tables and two columns:
--   profiles.photo_declared_at      the profile-photo step is self-declared,
--                                   because no API tells us their photo is good
--   onboarding_progress             one row per (creator, step): first seen,
--                                   completed. THE funnel truth the brain reads.
--   onboarding_nudge_state          one row per creator: how many nudges, when
--                                   the last one went, why we stopped.
--   onboarding_nudges               one row per nudge that actually went out,
--                                   unique on external_id so a crashed tick
--                                   cannot log the same send twice.
--   funnel_settings.onboarding_nudges_enabled   the kill switch.

alter table public.profiles
  add column if not exists photo_declared_at timestamptz;

create table if not exists public.onboarding_progress (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  step text not null check (step in ('instagram','community','affiliate','photo','bio')),
  first_seen_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, step)
);

create table if not exists public.onboarding_nudge_state (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  nudge_count integer not null default 0,
  last_nudged_at timestamptz,
  last_step text,
  stopped_at timestamptz,
  stop_reason text,
  updated_at timestamptz not null default now()
);

create table if not exists public.onboarding_nudges (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  step text not null,
  -- 'freeform' rode an open 24h window; 'template' is a Meta-approved send.
  kind text not null check (kind in ('freeform','template')),
  -- The freeform variant key or the template key, so rotation never repeats
  -- the same wording twice in a row.
  variant text not null,
  external_id text not null unique,
  sent_at timestamptz not null default now()
);

create index if not exists onboarding_nudges_profile_idx
  on public.onboarding_nudges (profile_id, sent_at desc);

-- Same posture as every funnel table (021): admins read, and there are
-- deliberately NO insert or update policies. Every write is a service-role
-- server route; the browser must not be able to forge a completed step or a
-- nudge record.
alter table public.onboarding_progress enable row level security;
alter table public.onboarding_nudge_state enable row level security;
alter table public.onboarding_nudges enable row level security;

drop policy if exists onboarding_progress_admin_read on public.onboarding_progress;
create policy onboarding_progress_admin_read
  on public.onboarding_progress for select using (public.is_admin());

drop policy if exists onboarding_nudge_state_admin_read on public.onboarding_nudge_state;
create policy onboarding_nudge_state_admin_read
  on public.onboarding_nudge_state for select using (public.is_admin());

drop policy if exists onboarding_nudges_admin_read on public.onboarding_nudges;
create policy onboarding_nudges_admin_read
  on public.onboarding_nudges for select using (public.is_admin());

-- ON by default, unlike the other switches: Hugo asked for the brain in as many
-- words, and every send still passes quiet hours, the reply pause, the shared
-- 250/24h cap, the do-not-text tag and the 24h-window/template rules at the
-- wk-partner-api door. Flipping this false silences onboarding nudges only.
alter table public.funnel_settings
  add column if not exists onboarding_nudges_enabled boolean not null default true;
