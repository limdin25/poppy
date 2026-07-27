-- One-off: give the owner-less contacts an owner, from whoever actually
-- worked them. Hugo approved 2026-07-27.
--
-- Hugo asked for the owning agent's name on every lead card, on every screen.
-- 307 of 3,510 contacts had owner_agent_id = NULL, so those cards would read
-- "Unassigned" forever. They turned out to be the dead US plumber batch of
-- 16-17 Jul (the sends that died to Twilio geo-permissions 21408) plus a
-- handful of test rows — 305 of them sit in no pipeline column at all.
--
-- Evidence, most recent wins:
--   wk_calls.agent_id                 — someone rang them
--   wk_sms_messages.created_by        — someone texted them (outbound only)
-- Anything with no evidence keeps NULL and renders an honest "Unassigned";
-- we do not guess.
--
-- Every pre-image is written to wk_contacts_owner_backfill_20260727 BEFORE the
-- update, and the revert block is at the bottom of this file.
--
-- Deliberately does NOT mention pipeline_column_id in the SET list, so the
-- stage-move triggers added in 20260727000006 never fire for this.
--
-- Re-run safe: the backup insert is guarded, and the update only ever touches
-- rows that are still NULL.

-- ── 1. backup, before anything is written ───────────────────────────────────
create table if not exists wk_contacts_owner_backfill_20260727 (
  contact_id     uuid primary key references wk_contacts(id) on delete cascade,
  owner_agent_id uuid,          -- the pre-image: NULL for every row here
  backed_up_at   timestamptz not null default now()
);

insert into wk_contacts_owner_backfill_20260727 (contact_id, owner_agent_id)
select c.id, c.owner_agent_id
from wk_contacts c
where c.owner_agent_id is null
on conflict (contact_id) do nothing;

-- ── 2. resolve the worker, most recent contact wins ─────────────────────────
with evidence as (
  select c.id as contact_id, e.agent_id
  from wk_contacts c
  cross join lateral (
    select agent_id, ts from (
      select k.agent_id, k.started_at as ts
        from wk_calls k
       where k.contact_id = c.id and k.agent_id is not null
      union all
      select m.created_by, m.created_at
        from wk_sms_messages m
       where m.contact_id = c.id
         and m.created_by is not null
         and m.direction = 'outbound'
    ) all_touches
    order by ts desc nulls last
    limit 1
  ) e
  where c.owner_agent_id is null
    -- never point the FK at an auth user with no profiles row
    and exists (select 1 from profiles p where p.id = e.agent_id)
)
update wk_contacts c
   set owner_agent_id = ev.agent_id
  from evidence ev
 where c.id = ev.contact_id
   and c.owner_agent_id is null;

comment on table wk_contacts_owner_backfill_20260727 is
  'Pre-images for the 2026-07-27 owner backfill. Every row had owner_agent_id = NULL. Revert: update wk_contacts c set owner_agent_id = b.owner_agent_id from wk_contacts_owner_backfill_20260727 b where c.id = b.contact_id;';

-- ── REVERT (run by hand if this was wrong) ──────────────────────────────────
-- update wk_contacts c
--    set owner_agent_id = b.owner_agent_id
--   from wk_contacts_owner_backfill_20260727 b
--  where c.id = b.contact_id;
