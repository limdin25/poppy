-- Inbox participation (Hugo 2026-07-26): an agent must see conversations for
-- every lead they've PARTICIPATED with — texted or called — not only leads
-- they own or are assigned. 306 of 332 SMS threads were on unowned leads, so
-- the agent who sent 300 texts saw an empty inbox.
--
-- READ-ONLY, additive: a separate FOR SELECT permissive policy (OR'd with the
-- existing owner/assignment/admin rw policy). It NEVER grants write on a
-- lead the agent merely contacted — editing still requires ownership.

create index if not exists wk_sms_messages_createdby_contact_idx
  on wk_sms_messages (created_by, contact_id);
create index if not exists wk_calls_agent_contact_idx
  on wk_calls (agent_id, contact_id);

drop policy if exists wk_contacts_participation_read on wk_contacts;
create policy wk_contacts_participation_read on wk_contacts
  for select to authenticated
  using (
    exists (
      select 1 from wk_sms_messages m
      where m.contact_id = wk_contacts.id and m.created_by = auth.uid()
    )
    or exists (
      select 1 from wk_calls k
      where k.contact_id = wk_contacts.id and k.agent_id = auth.uid()
    )
  );
