-- The video funnel stops hijacking the sales pipeline.
--
-- Hugo 2026-07-27: "they should still pick an outcome of the call for the
-- pipeline, we already have the video funnel here, so we don't need those
-- columns visible on pipelines."
--
-- THE REAL PROBLEM, which hiding the columns alone would not fix: the funnel
-- WRITES wk_contacts.pipeline_column_id (api/lib/vsl-settings.ts
-- movePipelineCardToColumn). A lead an agent had marked "Interested" was
-- silently moved to "Video sent" the moment the video went out — the human's
-- call outcome was destroyed by an automated system. Hiding the columns would
-- have made those leads vanish from the board instead.
--
-- The two are INDEPENDENT axes and now stay that way:
--   wk_contacts.pipeline_column_id  — what the human learned on the call
--   wk_vsl_pages.state              — where the video is in its journey
-- A lead can be "Interested" AND "Watched video" at once, and the funnel card
-- shows the call outcome alongside its stage.
--
-- Re-run safe.

-- ── 1. columns can be archived rather than deleted ──────────────────────────
-- Not a DROP: wk_activities.meta rows reference these ids by uuid, and the
-- stage-history backfill points at them. Archiving keeps that history readable.
alter table wk_pipeline_columns
  add column if not exists archived boolean not null default false;

comment on column wk_pipeline_columns.archived is
  'Hidden from the pipeline board and every stage picker. Kept, not deleted, so wk_activities history that references the column id still resolves to a name.';

-- ── 2. park any lead currently sitting in a funnel column ───────────────────
-- Their real outcome was never recorded (the funnel overwrote it, or they were
-- never called), so NULL is the honest value: no human has dispositioned them.
-- They remain fully visible on the video funnel board.
create table if not exists wk_contacts_vsl_column_backup_20260727 (
  contact_id         uuid primary key references wk_contacts(id) on delete cascade,
  pipeline_column_id uuid,
  column_name        text,
  backed_up_at       timestamptz not null default now()
);

insert into wk_contacts_vsl_column_backup_20260727 (contact_id, pipeline_column_id, column_name)
select c.id, c.pipeline_column_id, col.name
from wk_contacts c
join wk_pipeline_columns col on col.id = c.pipeline_column_id
where col.name in (
  'Rendering', 'Ready to send', 'Video sent', 'Opened page',
  'Watched video', 'Clicked button', 'Checkout started', 'Paid'
)
on conflict (contact_id) do nothing;

update wk_contacts c
   set pipeline_column_id = null
  from wk_pipeline_columns col
 where col.id = c.pipeline_column_id
   and col.name in (
     'Rendering', 'Ready to send', 'Video sent', 'Opened page',
     'Watched video', 'Clicked button', 'Checkout started', 'Paid'
   );

-- ── 3. archive the funnel columns ───────────────────────────────────────────
update wk_pipeline_columns
   set archived = true
 where name in (
   'Rendering', 'Ready to send', 'Video sent', 'Opened page',
   'Watched video', 'Clicked button', 'Checkout started', 'Paid'
 );

-- REVERT:
--   update wk_pipeline_columns set archived = false where archived;
--   update wk_contacts c set pipeline_column_id = b.pipeline_column_id
--     from wk_contacts_vsl_column_backup_20260727 b where c.id = b.contact_id;
