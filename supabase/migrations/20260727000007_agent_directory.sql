-- One staff-gated roster read that ALWAYS resolves an owner_agent_id.
--
-- Hugo 2026-07-27: "leads must always show the name of who it belongs to, on
-- all pages." Five components each rolled their own profiles query
-- (ViewAsSelector, useAgentsToday, useCurrentAgent, useLiveActivity,
-- useDailyReports) and every one of them picked a DIFFERENT roster. Two of
-- those rosters silently omit a profile that has no workspace_role but does own
-- leads — Hugo's own login — so his name rendered as "Agent"/"Unassigned".
--
-- Not a plain PostgREST select on `profiles`: wk_handle_new_user creates a
-- profiles row for EVERY Elsie/reviews customer signup, so an unfiltered read
-- is unbounded and would ship the customer table to any agent's browser.
--
-- Roster union mirrors wk_leaderboard (20260727000003:103-118) so the directory
-- and the leaderboard can never disagree about who exists.
--
-- Re-run safe.

create or replace function public.wk_agent_directory()
returns table (
  id             uuid,
  name           text,
  email          text,
  workspace_role text,
  is_staff       boolean
)
language sql stable security definer set search_path = public as $$
  select
    p.id,
    coalesce(nullif(btrim(p.name), ''), p.email, 'Agent') as name,
    p.email,
    p.workspace_role,
    -- coalesce: workspace_role is NULL on real rows (Hugo's own login), and a
    -- NULL here would reach the client as `null`, not `false`.
    coalesce(p.workspace_role in ('agent', 'admin'), false) as is_staff
  from profiles p
  -- SECURITY DEFINER bypasses RLS, so THIS PREDICATE is the staff gate.
  where public.wk_is_agent_or_admin()
    and (
      p.workspace_role in ('agent', 'admin')
      or exists (select 1 from wk_voice_agent_limits l where l.agent_id = p.id)
      or exists (select 1 from wk_contacts c where c.owner_agent_id = p.id)   -- wk_contacts_owner_idx
      or exists (select 1 from wk_vsl_pages v where v.agent_id = p.id)        -- wk_vsl_pages_agent_idx
    )
  order by 2;
$$;

revoke all on function public.wk_agent_directory() from public, anon;
grant execute on function public.wk_agent_directory() to authenticated;

comment on function public.wk_agent_directory() is
  'Staff-gated agent roster: id -> name/email/role. Includes anyone who owns leads or VSL pages even without a workspace_role, so every wk_contacts.owner_agent_id resolves to a name. Read by useAgentDirectory().';
