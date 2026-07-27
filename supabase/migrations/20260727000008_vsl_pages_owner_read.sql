-- If you can see the lead, you can see its video page.
--
-- Hugo 2026-07-27 asked for the video timestamps on /crm/contacts. The read
-- policy on wk_vsl_pages keyed only on the PAGE's own agent_id, which is
-- narrower than wk_contacts' policy — so a lead you own whose video somebody
-- else made rendered an empty Video column, indistinguishable from "no video".
--
-- SELECT only. Writes stay service-role (there is no client write policy on
-- this table and this migration does not add one).
--
-- Re-run safe.

drop policy if exists wk_vsl_pages_agent_read on wk_vsl_pages;
create policy wk_vsl_pages_agent_read on wk_vsl_pages
  for select to authenticated
  using (
    wk_is_admin()
    or agent_id = auth.uid()
    or exists (
      select 1 from wk_contacts c
       where c.id = wk_vsl_pages.contact_id
         and c.owner_agent_id = auth.uid()
    )
  );
