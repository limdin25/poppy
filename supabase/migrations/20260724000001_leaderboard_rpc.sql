-- Leaderboard RPC — head-to-head agent stats that agents can actually see.
--
-- Hugo 2026-07-24: "make sure it shows who's calling more between them two …
-- sometimes we have other agents, they don't show."
--
-- Why they didn't show: the leaderboard was built client-side from wk_calls,
-- and that table's RLS is `wk_is_admin() OR agent_id = auth.uid()`. So an
-- agent's browser only ever received their OWN calls — Marr saw Marr, Pedro
-- saw Pedro, and neither could see the competition. Only Hugo (admin) saw a
-- real board. Aggregating server-side in a SECURITY DEFINER function fixes it
-- without loosening RLS: this returns counts and names only, never call rows,
-- transcripts, contacts or numbers.
--
-- Second fix: agents with no activity yet are included with zeros, so the
-- head-to-head is always a full board instead of silently dropping whoever
-- hasn't dialled today.
--
-- Roster = anyone who is a CRM agent (profiles.workspace_role = 'agent') or
-- has a wk_voice_agent_limits row, minus anyone an admin has un-ticked via
-- wk_voice_agent_limits.show_on_leaderboard (Settings → Agents & spend).

create or replace function public.wk_leaderboard(p_since timestamptz)
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
      and k.agent_id is not null
    group by k.agent_id
  ),
  message_stats as (
    select m.created_by as agent_id, count(*) as messages_sent
    from wk_sms_messages m
    where m.direction = 'outbound'
      and m.created_at >= p_since
      and m.created_by is not null
    group by m.created_by
  ),
  spend_stats as (
    select k.agent_id, coalesce(sum(v.total_pence), 0) as spend_pence
    from wk_calls k
    join wk_voice_call_costs v on v.call_id = k.id
    where k.started_at >= p_since
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
  order by coalesce(c.answered, 0) desc, coalesce(c.calls, 0) desc, r.name asc;
$$;

revoke all on function public.wk_leaderboard(timestamptz) from public;
grant execute on function public.wk_leaderboard(timestamptz) to authenticated;

comment on function public.wk_leaderboard(timestamptz) is
  'Aggregate-only agent leaderboard since p_since. SECURITY DEFINER so agents can see each other''s totals without wk_calls RLS exposing call rows. Staff-only; honours wk_voice_agent_limits.show_on_leaderboard.';
