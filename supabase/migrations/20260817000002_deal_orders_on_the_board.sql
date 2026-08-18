-- THE PIPELINE CARD CARRIES THE BRAIN'S CURRENT ORDER.
--
-- 2026-08-17, afternoon. Hugo, with two screenshots of one deal: the cockpit
-- said "Reply holding at 96,375, ask for the video walkthrough" while the DDM
-- pipeline card said "Renegotiate" and "Pedro today: Ring Doug". "DDM are
-- contradicting on pipeline against cockpit. It's not informing what to do on
-- the pipeline."
--
-- The card's instruction sources (the call-outcome brief, the pinned note,
-- custom_fields.next_step) all stop updating once the brain takes over. The
-- brain's current order lives in wk_deal_manager_log assessment rows, and the
-- board read none of them.
--
-- The board also must NOT read them raw. wk_deal_manager_log_read is a row
-- filter: for an agent it silently skips rows flagged blocked_needs_hugo /
-- figure_mismatch / stage_mismatch, so "the newest row" on a Pedro session is
-- an OLDER visible row. That is the exact Zest "Hold, nothing today" bug
-- (see 20260817000001) reborn on the board. So the board comes through this
-- function, which reads past the policy and then applies the SAME privacy by
-- hand: a hidden newest row reaches a non-admin with instruction and action
-- stripped, plus the one harmless fact "this is Hugo's move, since when" when
-- that is what the flag says.

create or replace function public.wk_deal_orders(p_contact_ids uuid[])
returns table (
  contact_id uuid,
  property_id uuid,
  instruction text,
  action text,
  who text,
  confidence text,
  source text,
  at timestamptz,
  blocked_on_hugo boolean
)
language sql
security definer
set search_path = public
as $$
  with newest as (
    select distinct on (l.contact_id)
           l.contact_id, l.property_id, l.instruction, l.action, l.who,
           l.confidence, l.source, l.created_at, l.flags
      from wk_deal_manager_log l
     where l.contact_id = any(p_contact_ids)
       and l.kind in ('assessment', 'fallback_refused')
     order by l.contact_id, l.created_at desc
  ),
  judged as (
    select n.*,
           -- The same three flags wk_deal_manager_log_read hides, verbatim.
           (n.flags && array['blocked_needs_hugo', 'figure_mismatch', 'stage_mismatch']::text[])
             as hidden
      from newest n
  )
  select j.contact_id,
         j.property_id,
         case when j.hidden and not wk_is_admin() then null else j.instruction end,
         case when j.hidden and not wk_is_admin() then null else j.action end,
         j.who,
         case when j.hidden and not wk_is_admin() then null else j.confidence end,
         j.source,
         j.created_at,
         -- The one fact an agent may know about a hidden row: whose move it
         -- is. Same predicate as wk_deals_blocked_on_hugo, so the two doors
         -- can never disagree about what "waiting on Hugo" means.
         (j.who = 'HUGO' and j.flags && array['blocked_needs_hugo']::text[])
    from judged j
   where wk_is_agent_or_admin() or auth.role() = 'service_role';
$$;

comment on function public.wk_deal_orders(uuid[]) is
  'The newest brain judgement per branch contact, for the pipeline board. '
  'Applies by hand the same privacy wk_deal_manager_log_read enforces: a '
  'non-admin gets a hidden row with instruction, action and confidence '
  'stripped, plus blocked_on_hugo when that is what the flag says. Exists so '
  'the board mirrors the cockpit instead of silently reading an older row.';

revoke all on function public.wk_deal_orders(uuid[]) from public, anon;
grant execute on function public.wk_deal_orders(uuid[]) to authenticated, service_role;
