-- Live counts for the website sales flow canvas.
--
-- WHY AN RPC AND NOT A CLIENT COUNT
-- wk_site_pages has agent/admin RLS, so a count() from the browser silently
-- returns a partial number for an agent and looks like a bug rather than a
-- permission. SECURITY DEFINER lets one query answer for whoever is asking,
-- with the same staff gate the VSL aggregates use: reviews clients and business
-- owners are authenticated too, and must never see any of this.
--
-- EVER_REACHED IS COMPUTED FORWARD-ONLY, NEVER FROM state.
-- state is forward-only and collapses: a converted lead is no longer "in"
-- opened, but it definitely reached it. Counting the state column would report
-- "opened: 0, converted: 1" and make every drop-off percentage on the canvas a
-- lie. The *_at columns are monotone, so "reached at least stage X" is exactly
-- "X_at is not null".
--
-- The two stages that are not states get counted from their own columns:
-- nudged from nudge_count, ai_calling from outbound_call_attempts. They were
-- deliberately left out of the state enum because a lead who is nudged and
-- then opens would have to move backwards.

drop function if exists public.wk_site_funnel_summary(timestamptz, timestamptz, uuid);

create or replace function public.wk_site_funnel_summary(
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_agent uuid default null           -- null = everyone the caller may see
)
returns table (state text, in_state int, ever_reached int)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    select p.*
    from wk_site_pages p
    where (p_from is null or p.created_at >= p_from)
      and (p_to is null or p.created_at < p_to)
      and (p_agent is null or p.agent_id = p_agent)
      -- Mirrors the RLS this function bypasses: agents see their own, admins
      -- see the lot, and nobody else sees anything at all.
      and (public.wk_is_admin() or p.agent_id = auth.uid())
      and public.wk_is_agent_or_admin()
  )
  select 'created'::text,
         count(*) filter (where v.state = 'created')::int,
         count(*)::int
  from visible v
  union all
  select 'sent',
         count(*) filter (where v.state = 'sent')::int,
         count(*) filter (where v.sent_at is not null)::int
  from visible v
  union all
  select 'opened',
         count(*) filter (where v.state = 'opened')::int,
         count(*) filter (where v.first_opened_at is not null)::int
  from visible v
  union all
  select 'engaged',
         count(*) filter (where v.state = 'engaged')::int,
         count(*) filter (where v.first_engaged_at is not null)::int
  from visible v
  union all
  -- Not a state. A lead is "in" nudging when they have been nudged and have
  -- not engaged or moved on.
  select 'nudged',
         count(*) filter (
           where v.nudge_count > 0 and v.state in ('sent', 'opened')
         )::int,
         count(*) filter (where v.nudge_count > 0)::int
  from visible v
  union all
  -- Also not a state, same reasoning.
  select 'ai_calling',
         count(*) filter (
           where v.outbound_call_attempts > 0 and v.state in ('sent', 'opened')
         )::int,
         count(*) filter (where v.outbound_call_attempts > 0)::int
  from visible v
  union all
  select 'checkout_sent',
         count(*) filter (where v.state = 'checkout_sent')::int,
         count(*) filter (where v.checkout_sent_at is not null)::int
  from visible v
  union all
  select 'converted',
         count(*) filter (where v.state = 'converted')::int,
         count(*) filter (where v.converted_at is not null)::int
  from visible v;
$$;

revoke all on function public.wk_site_funnel_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.wk_site_funnel_summary(timestamptz, timestamptz, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- REVERT (run by hand):
--   drop function if exists public.wk_site_funnel_summary(timestamptz, timestamptz, uuid);
