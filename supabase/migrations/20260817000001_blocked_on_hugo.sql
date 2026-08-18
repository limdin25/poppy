-- PEDRO MUST BE ABLE TO SEE THAT A DEAL IS ALIVE, WITHOUT SEEING WHY.
--
-- 2026-08-17. Hugo screenshotted the Zest Hull card reading "Hold, nothing
-- today" and said the brain should have been telling him to send the email.
-- The brain WAS. It had decided, eight assessments in a row, "Offer of 103,600
-- is placed and Lucy is waiting on proof of funds. Email Pedro your bank
-- statement", who=HUGO. Every one of those rows carried the flag
-- blocked_needs_hugo, and wk_deal_manager_log_read hides exactly those rows
-- from anyone who is not an admin. The screenshot was a PEDRO session, so his
-- cockpit found no readable assessment, fell back to a two day old
-- deterministic brief, and printed the one thing that was not true.
--
-- The RLS rule is RIGHT and stays. Hugo's escalation lane is where the money
-- reasoning, the proof of funds and his pinned rulings live, and it should not
-- be readable by an agent today or by the agents he hires later.
--
-- What was missing is that hiding the order left NOTHING in its place. This
-- function is that something: for a set of properties it answers only "is the
-- newest decision one that belongs to Hugo, and since when". No instruction,
-- no evidence, no figures, no state. A name and a timestamp cannot leak a
-- negotiating position.
--
-- SECURITY DEFINER because it must read past the very policy it exists to
-- work around. It returns three harmless columns and nothing else, and it is
-- granted to authenticated only.

create or replace function public.wk_deals_blocked_on_hugo(p_property_ids uuid[])
returns table (property_id uuid, since timestamptz)
language sql
security definer
set search_path = public
as $$
  -- The newest assessment per property, and only when that newest one is
  -- Hugo's. A deal whose latest decision is Pedro's is not blocked on anybody,
  -- even if an older row once was.
  with newest as (
    select distinct on (l.property_id)
           l.property_id, l.who, l.flags, l.created_at
      from wk_deal_manager_log l
     where l.property_id = any(p_property_ids)
       and l.kind in ('assessment', 'fallback_refused')
     order by l.property_id, l.created_at desc
  )
  select n.property_id, n.created_at
    from newest n
   where n.who = 'HUGO'
     and n.flags && array['blocked_needs_hugo']::text[]
     -- Only answer for callers who are allowed in the CRM at all. An admin
     -- can read the real rows anyway, so this is for agents, but gating it
     -- keeps the function useless to anybody else.
     and (wk_is_agent_or_admin() or auth.role() = 'service_role');
$$;

comment on function public.wk_deals_blocked_on_hugo(uuid[]) is
  'Which of these deals are waiting on Hugo, and since when. Deliberately '
  'returns no instruction, evidence, figures or state: it exists so an agent '
  'sees that a deal is alive and not his move, without seeing the reasoning '
  'that wk_deal_manager_log_read hides on purpose.';

revoke all on function public.wk_deals_blocked_on_hugo(uuid[]) from public, anon;
grant execute on function public.wk_deals_blocked_on_hugo(uuid[]) to authenticated, service_role;
