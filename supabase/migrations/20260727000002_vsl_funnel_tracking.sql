-- Full funnel tracking: link click, video play, real watch coverage, 100%
-- completion — plus the notifications feed that surfaces all of it.
--
-- Hugo 2026-07-26: "audit if it's already wired and where I can see" → half the
-- signals were missing, wk_vsl_events was write-only, and nothing notified.
--
-- Three parts:
--   1. wk_vsl_pages gains first_click_at / click_count / play_at / completed_at
--   2. wk_vsl_advance learns to WRITE those, and to REPORT what was newly
--      reached, so callers can notify exactly once per milestone
--   3. wk_notifications — the persistent bell/pop-up/email feed
--
-- Re-run safe throughout.

-- ============ 1. new page columns ============
alter table wk_vsl_pages
  add column if not exists first_click_at timestamptz,
  add column if not exists click_count int not null default 0,
  add column if not exists play_at timestamptz,
  add column if not exists completed_at timestamptz;

-- ============ 2. the advance RPC ============
-- The old signature could only bump open_count and watched_pct — it had no way
-- to set first_click_at/play_at/completed_at at all. Doing those writes from JS
-- would reintroduce the stale read-modify-write that 20260725000002 existed to
-- kill, so they move INTO the locked section here.
--
-- The DROP is mandatory for two independent reasons: a function's OUT columns
-- cannot be changed by CREATE OR REPLACE, and leaving the 4-arg version alive
-- would make this an overload — PostgREST's named-argument call from
-- api/lib/vsl-settings.ts would then fail with PGRST203 (ambiguous).
drop function if exists public.wk_vsl_advance(uuid, text, int, boolean);

create or replace function public.wk_vsl_advance(
  p_page_id uuid,
  p_target text default null,      -- null = only bump counters, no state change
  p_watched_pct int default null,  -- null = leave; else max(current, this)
  p_bump_open boolean default false,
  p_link_click boolean default false,  -- SMS link tapped (server-side)
  p_play boolean default false,        -- video started
  p_completed boolean default false    -- watched to the end
)
returns table (
  state text,
  advanced boolean,
  contact_id uuid,
  pct_before int,          -- watched_pct BEFORE this call, for milestone dedupe
  first_click boolean,
  first_open boolean,
  first_play boolean,
  first_complete boolean
)
language plpgsql security definer set search_path = public as $$
declare
  r wk_vsl_pages%rowtype;
  v_advanced boolean := false;
  v_first_click boolean := false;
  v_first_open boolean := false;
  v_first_play boolean := false;
  v_first_complete boolean := false;
  v_pct_before int := 0;
begin
  select * into r from wk_vsl_pages where id = p_page_id for update;
  if not found then return; end if;

  -- Everything below is computed from the LOCKED row, before the update. This
  -- is the only race-free place to decide "was this the first one?".
  v_pct_before := r.watched_pct;

  -- Derive first-touch from the COUNTERS, not the timestamps. first_opened_at
  -- is only written when p_target='opened' AND the rank advances, so a single
  -- dropped beacon (sendBeacon is best-effort) leaves it NULL forever and every
  -- later reload would report "first open" again. The counters are monotonic.
  v_first_click := p_link_click and r.click_count = 0;
  v_first_open  := p_bump_open  and r.open_count = 0;
  v_first_play  := p_play       and r.play_at is null;
  v_first_complete := p_completed and r.completed_at is null;

  if p_target is not null and wk_vsl_rank(p_target) > wk_vsl_rank(r.state) then
    r.state := p_target;
    v_advanced := true;
    r.sent_at             := coalesce(r.sent_at,             case when p_target='sent' then now() end);
    r.first_opened_at     := coalesce(r.first_opened_at,     case when p_target='opened' then now() end);
    r.watched_at          := coalesce(r.watched_at,          case when p_target='watched' then now() end);
    r.cta_clicked_at      := coalesce(r.cta_clicked_at,      case when p_target='cta_clicked' then now() end);
    r.checkout_started_at := coalesce(r.checkout_started_at, case when p_target='checkout_started' then now() end);
    r.paid_at             := coalesce(r.paid_at,             case when p_target='paid' then now() end);
  end if;

  -- A beacon may arrive before the state ever reached 'opened' (a dropped open
  -- beacon, or a click logged server-side first) — stamp first_opened_at from
  -- the counter path too so the board is never blank for a page with opens.
  if p_bump_open then
    r.first_opened_at := coalesce(r.first_opened_at, now());
  end if;

  update wk_vsl_pages set
    state = r.state,
    sent_at = r.sent_at, first_opened_at = r.first_opened_at, watched_at = r.watched_at,
    cta_clicked_at = r.cta_clicked_at, checkout_started_at = r.checkout_started_at, paid_at = r.paid_at,
    watched_pct = greatest(watched_pct, coalesce(p_watched_pct, 0)),
    open_count = open_count + (case when p_bump_open then 1 else 0 end),
    click_count = click_count + (case when p_link_click then 1 else 0 end),
    first_click_at = coalesce(first_click_at, case when p_link_click then now() end),
    play_at        = coalesce(play_at,        case when p_play      then now() end),
    completed_at   = coalesce(completed_at,   case when p_completed then now() end)
  where id = p_page_id;

  return query select
    r.state, v_advanced, r.contact_id, v_pct_before,
    v_first_click, v_first_open, v_first_play, v_first_complete;
end;
$$;

-- MANDATORY. The DROP above destroyed the ACL from 20260725000002, and a fresh
-- CREATE grants EXECUTE TO PUBLIC by default. This function is SECURITY DEFINER
-- and writes the funnel: without this, anyone holding the public anon key could
-- call wk_vsl_advance(<page_id>, 'paid') on any lead's page.
revoke all on function public.wk_vsl_advance(uuid, text, int, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;

comment on function public.wk_vsl_advance(uuid, text, int, boolean, boolean, boolean, boolean) is
  'Atomic forward-only funnel advance. Writes first_click_at/play_at/completed_at and reports which touches were the FIRST (computed under the row lock) so callers notify exactly once. Service-role only.';

-- ============ 3. notifications feed ============
-- One row per notify-worthy funnel event, owned by the agent whose lead it is.
-- Admins read everything (Hugo sees every agent). All writes are service-role.
create table if not exists wk_notifications (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references profiles(id) on delete cascade,
  contact_id uuid references wk_contacts(id) on delete cascade,
  page_id uuid references wk_vsl_pages(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null default '',
  link text,
  meta jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  -- null = still queued for email. The cron drains it; emailing inline from the
  -- lead-facing page would risk a blank page for a prospect (no waitUntil in
  -- this stack, and sendNotification throws on a Resend 429).
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists wk_notifications_feed_idx
  on wk_notifications (agent_id, created_at desc);
create index if not exists wk_notifications_email_queue_idx
  on wk_notifications (created_at) where emailed_at is null;

alter table wk_notifications enable row level security;

drop policy if exists wk_notifications_read on wk_notifications;
create policy wk_notifications_read on wk_notifications for select to authenticated
  using (wk_is_admin() or agent_id = auth.uid());

-- Marking read is the only client write. No INSERT policy: the backend writes
-- these with the service-role key, same shape as wk_vsl_pages.
drop policy if exists wk_notifications_mark_read on wk_notifications;
create policy wk_notifications_mark_read on wk_notifications for update to authenticated
  using (agent_id = auth.uid())
  with check (agent_id = auth.uid());

-- Realtime needs the full old row when an RLS policy references a non-PK column
-- (house rule, 20260503000002) — without this the read_at UPDATEs never arrive.
alter table wk_notifications replica identity full;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'wk_notifications'
  ) then
    alter publication supabase_realtime add table wk_notifications;
  end if;
end $$;

-- The card drawer and the lead timeline read raw events; 20260725000001 only
-- put wk_vsl_pages on realtime, so those views were stale until a refetch.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'wk_vsl_events'
  ) then
    alter publication supabase_realtime add table wk_vsl_events;
  end if;
end $$;
