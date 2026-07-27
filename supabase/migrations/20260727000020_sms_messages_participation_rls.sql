-- wk_sms_messages was readable by EVERY member of staff.
--
-- Hugo, 2026-07-27, viewing the CRM as Pedro and seeing texts a different
-- agent had just sent: "I am inside pedro and I can see Marias text, the app
-- needs indviduality."
--
-- The audit that followed found ONE hole, not a general one. Every other
-- agent-scoped table already restricts by agent:
--
--   wk_calls        wk_is_admin() OR agent_id = auth.uid()
--   wk_contacts     owner OR active assignment OR participation (called/texted)
--   wk_vsl_pages    scoped        wk_notifications  scoped
--
-- wk_sms_messages alone read `wk_is_agent_or_admin()`, which asks "are you
-- staff", never "is this yours". Measured before this migration: the workspace
-- held 511 messages and BOTH agents could read all 511, including all 56 texts
-- an unrelated third agent had sent minutes earlier.
--
-- The replacement mirrors the wk_contacts participation model exactly, so the
-- inbox keeps showing an agent the full history of a lead they are genuinely
-- working, and nothing else:
--
--   admin                        → everything
--   created_by = me              → texts I sent
--   I own the contact            → its whole thread
--   I have an active assignment  → its whole thread
--   I have called the contact    → its whole thread
--
-- WHY THE HELPER IS SECURITY DEFINER. wk_contacts' own participation policy
-- subqueries wk_sms_messages. If this policy subqueried wk_contacts directly,
-- the two policies would reference each other and Postgres would abort with
-- "infinite recursion detected in policy for relation". The helper runs with
-- RLS bypassed inside, which breaks the cycle. It takes a contact id and
-- answers only about the caller, so it leaks nothing a policy would not.

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
  );
$$;

-- SECURITY DEFINER means anon must never be able to call it directly.
revoke all on function wk_agent_participates(uuid) from public, anon;
grant execute on function wk_agent_participates(uuid) to authenticated, service_role;

drop policy if exists wk_sms_messages_read on wk_sms_messages;

create policy wk_sms_messages_read on wk_sms_messages
for select
using (
  wk_is_admin()
  or created_by = auth.uid()
  or wk_agent_participates(contact_id)
);

-- The policy filters on these three every read.
create index if not exists wk_calls_contact_agent_idx
  on wk_calls (contact_id, agent_id);
create index if not exists wk_sms_messages_contact_created_by_idx
  on wk_sms_messages (contact_id, created_by);
create index if not exists wk_lead_assignments_contact_agent_idx
  on wk_lead_assignments (contact_id, agent_id);
