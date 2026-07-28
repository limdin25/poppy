-- Hugo, 2026-07-28: two rules for the growing bench of test agents (Maria
-- today, more coming as the "business tester" roster grows), on top of the
-- SMS participation RLS from 20260727000020:
--
--   1. A flagged test agent's sent texts must be invisible to every OTHER
--      agent, full stop, even on a lead that agent is actively calling.
--      This REVERSES the "thats fine then" carve-out accepted the day
--      before (see that migration's comment) but only for agents explicitly
--      marked isolated. Pedro and Marr keep the old participation model
--      between themselves — nothing changes for them.
--   2. No lead is ever worked by two different agents, at all. Once ANY
--      agent has texted or called a contact, no OTHER agent may text or
--      call it. Enforced at send time in wk-sms-send / wk-calls-create
--      (not just at import time) because a lead can end up shared by
--      accident regardless of how careful the import script is — that is
--      exactly how Maria's test batch overlapped Pedro's and Marr's calls.

-- Part 1: isolated-agent flag + generalized SMS read policy.

alter table profiles
  add column if not exists is_isolated_agent boolean not null default false;

comment on column profiles.is_isolated_agent is
  'Test/experiment agents (e.g. Maria) whose sent messages stay invisible to every other non-admin agent, even on a lead that agent is working.';

create or replace function wk_is_isolated_sender(p_agent uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_isolated_agent from profiles where id = p_agent),
    false
  );
$$;

revoke all on function wk_is_isolated_sender(uuid) from public, anon;
grant execute on function wk_is_isolated_sender(uuid) to authenticated, service_role;

drop policy if exists wk_sms_messages_read on wk_sms_messages;

create policy wk_sms_messages_read on wk_sms_messages
for select
using (
  wk_is_admin()
  or created_by = auth.uid()
  or (wk_agent_participates(contact_id) and not wk_is_isolated_sender(created_by))
);

update profiles set is_isolated_agent = true
where email = 'plumberstexttest@heyelsie.com';

-- Part 2: one-agent-per-lead lock, checked by the edge functions before
-- they let a send/dial through. Only counts real workspace agents
-- (workspace_role = 'agent') on both sides — admin sends never create or
-- break a lock, so Hugo can always check in on any lead without freezing it
-- for whoever owns it.

create or replace function wk_contact_locked_agent(p_contact uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select agent_id from (
    select m.created_by as agent_id, m.created_at
    from wk_sms_messages m
    join profiles p on p.id = m.created_by
    where m.contact_id = p_contact
      and m.direction = 'outbound'
      and p.workspace_role = 'agent'
    union all
    select k.agent_id, k.created_at
    from wk_calls k
    join profiles p on p.id = k.agent_id
    where k.contact_id = p_contact
      and p.workspace_role = 'agent'
  ) locked_by
  order by created_at asc
  limit 1;
$$;

revoke all on function wk_contact_locked_agent(uuid) from public, anon;
grant execute on function wk_contact_locked_agent(uuid) to authenticated, service_role;
