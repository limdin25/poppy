-- Line participation (Hugo 2026-08-03): a conversation happening on a number
-- ASSIGNED to an agent is that agent's conversation, full stop.
--
-- Why: the WhatsApp sender is Maria's line (+447460035763). A lead who
-- WhatsApps it cold creates an unowned contact that Maria never texted or
-- called, so under the participation rule (owner / assignment / texted /
-- called) the thread was invisible to her and sat admin-only. Hugo hunted
-- through every See-as view looking for a thread none of them could see.
--
-- Fix: 4th participation arm, "messages to or from one of my numbers".
-- The client twin lives in useInboxThreads (allowedSet build); the two must
-- stay in agreement or the list and RLS disagree about names.
--
-- CREATE OR REPLACE keeps the function's existing grants (authenticated,
-- service_role) and the revoke from anon/public.

create or replace function wk_agent_participates(p_contact uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_contact is not null and (
    exists (
      select 1 from wk_contacts c
      where c.id = p_contact and c.owner_agent_id = auth.uid()
    )
    or exists (
      select 1 from wk_lead_assignments la
      where la.contact_id = p_contact
        and la.agent_id = auth.uid()
        and la.status = any (array['assigned'::text, 'in_progress'::text])
    )
    or exists (
      select 1 from wk_calls k
      where k.contact_id = p_contact and k.agent_id = auth.uid()
    )
    -- Their line, their leads: any message on this contact that travelled
    -- over a number assigned to the calling agent.
    or exists (
      select 1
      from wk_sms_messages m
      join wk_numbers n on (m.to_e164 = n.e164 or m.from_e164 = n.e164)
      join wk_number_agents na on na.number_id = n.id
      where m.contact_id = p_contact
        and na.agent_id = auth.uid()
    )
  );
$$;
