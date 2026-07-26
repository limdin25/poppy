-- Funnel numbers for the board's conversion strip and the leaderboard.
--
-- Hugo 2026-07-26: "where can I see all as admin / what can each agent see" +
-- "all must show on the leaderboard".
--
-- TWO RULES drive the whole file:
--
-- 1. COUNT FROM THE TIMESTAMPS, NEVER FROM `state`. wk_vsl_pages.state is
--    forward-only — a paid lead is no longer 'opened' — so counting board
--    columns would report "opened: 0, paid: 1" and every drop-off percentage
--    would be nonsense. first_click_at/first_opened_at/play_at/... are
--    monotone, so "reached at least stage X" is exactly `X_at is not null`.
--
-- 2. SECURITY DEFINER + an explicit staff gate. Both functions bypass RLS to
--    aggregate across agents (wk_calls RLS clips an agent to their own rows),
--    so each one carries `where public.wk_is_agent_or_admin()` — reviews
--    clients and business owners are authenticated too and must never see this.
--    Pattern copied from 20260724000002_leaderboard_range.sql.
--
-- Watch milestones come from watched_pct, which is now real coverage (share of
-- the video actually decoded) rather than furthest playhead — see the cov()
-- helper in api/vsl/page.ts. A lead dragging the scrubber no longer counts.

-- ============ 1. board conversion strip ============
drop function if exists public.wk_vsl_funnel_summary(timestamptz, timestamptz, uuid);

create or replace function public.wk_vsl_funnel_summary(
  p_since timestamptz default null,
  p_until timestamptz default null,
  p_agent uuid default null          -- null = everyone (admin view)
)
returns table (
  created bigint, sent bigint, clicked bigint, opened bigint, played bigint,
  watched_50 bigint, watched_90 bigint, watched_100 bigint,
  cta_clicked bigint, checkout_started bigint, paid bigint
)
language sql stable security definer set search_path = public as $$
  select
    count(*),
    count(*) filter (where p.sent_at is not null),
    count(*) filter (where p.first_click_at is not null),
    count(*) filter (where p.first_opened_at is not null),
    count(*) filter (where p.play_at is not null),
    count(*) filter (where p.watched_pct >= 50),
    count(*) filter (where p.watched_pct >= 90),
    count(*) filter (where p.completed_at is not null or p.watched_pct >= 100),
    count(*) filter (where p.cta_clicked_at is not null),
    count(*) filter (where p.checkout_started_at is not null),
    count(*) filter (where p.paid_at is not null)
  from wk_vsl_pages p
  where (p_since is null or p.created_at >= p_since)
    and (p_until is null or p.created_at < p_until)
    and (p_agent is null or p.agent_id = p_agent)
    -- Agents see their own funnel; admins see the lot. Mirrors the RLS on
    -- wk_vsl_pages, which this function bypasses.
    and (public.wk_is_admin() or p.agent_id = auth.uid())
    and public.wk_is_agent_or_admin();
$$;

revoke all on function public.wk_vsl_funnel_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.wk_vsl_funnel_summary(timestamptz, timestamptz, uuid) to authenticated;

comment on function public.wk_vsl_funnel_summary(timestamptz, timestamptz, uuid) is
  'Video-funnel conversion counts, computed from the monotone *_at columns (never from state, which is forward-only). Staff-only; agents are scoped to their own pages.';

-- ============ 2. leaderboard, now with funnel columns ============
-- Replaces the 2-arg version from 20260724000002. OUT columns cannot be changed
-- by CREATE OR REPLACE, so this is a drop + recreate — which also destroys the
-- grants, hence the re-grant at the bottom.
--
-- Funnel activity is bounded on WHEN IT HAPPENED, not when the page was made: a
-- page sent three weeks ago and watched today belongs in "today".
drop function if exists public.wk_leaderboard(timestamptz, timestamptz);

create or replace function public.wk_leaderboard(
  p_since timestamptz,
  p_until timestamptz default null
)
returns table (
  agent_id uuid,
  agent_name text,
  calls bigint,
  answered bigint,
  avg_duration_sec integer,
  messages_sent bigint,
  voicemail_drops bigint,
  spend_pence bigint,
  videos_sent bigint,
  links_clicked bigint,
  pages_opened bigint,
  videos_played bigint,
  watched_50 bigint,
  watched_90 bigint,
  watched_100 bigint,
  cta_clicks bigint,
  paid bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with roster as (
    select
      p.id,
      coalesce(nullif(btrim(p.name), ''), p.email, 'Agent') as name
    from profiles p
    left join wk_voice_agent_limits l on l.agent_id = p.id
    where (
        p.workspace_role = 'agent'
        or l.agent_id is not null
        -- Hugo asked for "all on the leaderboard". An admin with no
        -- wk_voice_agent_limits row was previously absent entirely, so his OWN
        -- funnel numbers were invisible. Anyone holding VSL pages now appears.
        or exists (select 1 from wk_vsl_pages v where v.agent_id = p.id)
      )
      and coalesce(l.show_on_leaderboard, true)
  ),
  call_stats as (
    select
      k.agent_id,
      count(*) as calls,
      count(*) filter (
        where k.status in ('completed', 'in_progress', 'voicemail')
      ) as answered,
      coalesce(
        round(
          avg(k.duration_sec) filter (
            where k.status in ('completed', 'in_progress', 'voicemail')
              and coalesce(k.duration_sec, 0) > 0
          )
        ),
        0
      )::int as avg_duration_sec,
      count(*) filter (where k.voicemail_dropped) as voicemail_drops
    from wk_calls k
    where k.started_at >= p_since
      and (p_until is null or k.started_at < p_until)
      and k.agent_id is not null
    group by k.agent_id
  ),
  message_stats as (
    select m.created_by as agent_id, count(*) as messages_sent
    from wk_sms_messages m
    where m.direction = 'outbound'
      and m.created_at >= p_since
      and (p_until is null or m.created_at < p_until)
      and m.created_by is not null
    group by m.created_by
  ),
  spend_stats as (
    select k.agent_id, coalesce(sum(v.total_pence), 0) as spend_pence
    from wk_calls k
    join wk_voice_call_costs v on v.call_id = k.id
    where k.started_at >= p_since
      and (p_until is null or k.started_at < p_until)
      and k.agent_id is not null
    group by k.agent_id
  ),
  -- One row per (agent, stage-timestamp-in-window). Each stage is counted on
  -- its OWN timestamp so a page can contribute to several stages in one window
  -- and to different windows for different stages.
  vsl_stats as (
    select
      v.agent_id,
      count(*) filter (where v.sent_at             between p_since and coalesce(p_until, now())) as videos_sent,
      count(*) filter (where v.first_click_at      between p_since and coalesce(p_until, now())) as links_clicked,
      count(*) filter (where v.first_opened_at     between p_since and coalesce(p_until, now())) as pages_opened,
      count(*) filter (where v.play_at             between p_since and coalesce(p_until, now())) as videos_played,
      count(*) filter (where v.watched_at          between p_since and coalesce(p_until, now()) and v.watched_pct >= 50)  as watched_50,
      count(*) filter (where v.watched_at          between p_since and coalesce(p_until, now()) and v.watched_pct >= 90)  as watched_90,
      count(*) filter (where coalesce(v.completed_at, v.watched_at) between p_since and coalesce(p_until, now()) and v.watched_pct >= 100) as watched_100,
      count(*) filter (where v.cta_clicked_at      between p_since and coalesce(p_until, now())) as cta_clicks,
      count(*) filter (where v.paid_at             between p_since and coalesce(p_until, now())) as paid
    from wk_vsl_pages v
    where v.agent_id is not null
    group by v.agent_id
  )
  select
    r.id,
    r.name,
    coalesce(c.calls, 0),
    coalesce(c.answered, 0),
    coalesce(c.avg_duration_sec, 0),
    coalesce(m.messages_sent, 0),
    coalesce(c.voicemail_drops, 0),
    coalesce(s.spend_pence, 0),
    coalesce(f.videos_sent, 0),
    coalesce(f.links_clicked, 0),
    coalesce(f.pages_opened, 0),
    coalesce(f.videos_played, 0),
    coalesce(f.watched_50, 0),
    coalesce(f.watched_90, 0),
    coalesce(f.watched_100, 0),
    coalesce(f.cta_clicks, 0),
    coalesce(f.paid, 0)
  from roster r
  left join call_stats c on c.agent_id = r.id
  left join message_stats m on m.agent_id = r.id
  left join spend_stats s on s.agent_id = r.id
  left join vsl_stats f on f.agent_id = r.id
  -- SECURITY DEFINER bypasses RLS, so gate the whole thing on staff. Reviews
  -- clients and owners are authenticated too and must never see this.
  where public.wk_is_agent_or_admin()
  order by coalesce(c.calls, 0) desc, coalesce(c.answered, 0) desc, r.name asc;
$$;

revoke all on function public.wk_leaderboard(timestamptz, timestamptz) from public;
grant execute on function public.wk_leaderboard(timestamptz, timestamptz) to authenticated;

comment on function public.wk_leaderboard(timestamptz, timestamptz) is
  'Aggregate-only agent leaderboard between p_since and p_until (exclusive; null = now), calls AND video funnel. SECURITY DEFINER so agents can see each other''s totals without wk_calls RLS exposing call rows. Staff-only; honours wk_voice_agent_limits.show_on_leaderboard.';
