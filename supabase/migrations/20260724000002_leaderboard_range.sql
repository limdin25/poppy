-- Leaderboard date ranges — backdated boards, not just "today".
--
-- Hugo 2026-07-24: "they called yesterday and the day before, make sure it
-- shows already." The board was today-only and today has no calls yet (Marr
-- 224 on the 23rd, Pedro 56 on the 22nd + 50 on the 23rd), so it read empty.
--
-- Adds an optional upper bound so a single past day (yesterday) can be asked
-- for, not just "everything since X". p_until is EXCLUSIVE — pass the start of
-- the following day.
--
-- Replaces the 1-arg version from 20260724000001. Callers passing only p_since
-- keep working unchanged (the default is null = no upper bound).

drop function if exists public.wk_leaderboard(timestamptz);

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
  spend_pence bigint
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
    where (p.workspace_role = 'agent' or l.agent_id is not null)
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
  )
  select
    r.id,
    r.name,
    coalesce(c.calls, 0),
    coalesce(c.answered, 0),
    coalesce(c.avg_duration_sec, 0),
    coalesce(m.messages_sent, 0),
    coalesce(c.voicemail_drops, 0),
    coalesce(s.spend_pence, 0)
  from roster r
  left join call_stats c on c.agent_id = r.id
  left join message_stats m on m.agent_id = r.id
  left join spend_stats s on s.agent_id = r.id
  -- SECURITY DEFINER bypasses RLS, so gate the whole thing on staff. Reviews
  -- clients and owners are authenticated too and must never see this.
  where public.wk_is_agent_or_admin()
  order by coalesce(c.calls, 0) desc, coalesce(c.answered, 0) desc, r.name asc;
$$;

revoke all on function public.wk_leaderboard(timestamptz, timestamptz) from public;
grant execute on function public.wk_leaderboard(timestamptz, timestamptz) to authenticated;

comment on function public.wk_leaderboard(timestamptz, timestamptz) is
  'Aggregate-only agent leaderboard between p_since and p_until (exclusive; null = now). SECURITY DEFINER so agents can see each other''s totals without wk_calls RLS exposing call rows. Staff-only; honours wk_voice_agent_limits.show_on_leaderboard.';
