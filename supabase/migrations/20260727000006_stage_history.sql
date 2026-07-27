-- Stage-move history: WHO moved this lead, WHEN, and FROM WHERE.
--
-- Hugo 2026-07-27: "the static pipeline must always show the last movement,
-- even manual, and by who." Nothing recorded stage changes anywhere — no
-- history table, no column, no trigger. wk_activities' CHECK already permitted
-- kind='stage_moved' but nothing had ever inserted one (0 rows live).
--
-- Why a TRIGGER and not app code: there are 15 distinct writers of
-- wk_contacts.pipeline_column_id — 6 UI paths through useContactPersistence,
-- 8 EditContactModal save handlers, plus TWO service-role movers
-- (api/lib/vsl-settings.ts movePipelineCardToColumn for the video funnel, and
-- api/crm/book.ts where the AI voice agent books a lead). Only the database
-- sees all of them.
--
-- Why BEFORE for the stamps and AFTER for the log: wk_contacts is
-- REPLICA IDENTITY FULL and published to supabase_realtime, so a second UPDATE
-- from inside an AFTER trigger would ship a second FULL-ROW realtime event per
-- drag and tick updated_at twice. Same split as 20260727000004_do_not_call.sql
-- (stamp = before, side effect = after).
--
-- Re-run safe.

-- ── 1. columns ──────────────────────────────────────────────────────────────
alter table wk_contacts
  add column if not exists stage_moved_at    timestamptz,
  add column if not exists stage_moved_by    uuid references profiles(id) on delete set null,
  add column if not exists stage_moved_from  uuid references wk_pipeline_columns(id) on delete set null,
  add column if not exists stage_move_source text;

alter table wk_contacts drop constraint if exists wk_contacts_stage_move_source_chk;
alter table wk_contacts add constraint wk_contacts_stage_move_source_chk
  check (stage_move_source is null
         or stage_move_source in ('agent', 'automation', 'import', 'backfill'));

comment on column wk_contacts.stage_moved_at is
  'When this lead last changed pipeline column. Stamped by wk_contacts_stage_move_stamp.';
comment on column wk_contacts.stage_moved_by is
  'profiles.id of the person who moved it. NULL whenever stage_move_source <> ''agent''.';
comment on column wk_contacts.stage_moved_from is
  'The column it came FROM. NULL for the first-ever stage and for backfilled rows.';
comment on column wk_contacts.stage_move_source is
  'agent | automation (service-role: video funnel, AI booking) | import | backfill.';

-- ── 2. actor resolution ─────────────────────────────────────────────────────
-- GUC first, so a future RPC can declare itself automation even when a user
-- triggered it. Then the service-role test: auth.uid() is NULL and auth.role()
-- is 'service_role' for every createClient(SERVICE_ROLE_KEY) write, which is
-- precisely the two automatic movers. Same coalesce(auth.role(),'service_role')
-- idiom already used at 20260715000001_crm_port.sql:1109.
create or replace function wk_stage_move_source() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('app.stage_move_source', true), ''),
    case
      when auth.uid() is null
        or coalesce(auth.role(), 'service_role') = 'service_role'
      then 'automation'
      else 'agent'
    end
  );
$$;

-- ── 3. BEFORE: stamp the denormalised columns ───────────────────────────────
-- Denormalised onto the row so a 1,100-card pipeline board renders the "last
-- moved" line with ZERO extra queries.
create or replace function wk_stamp_stage_move() returns trigger
language plpgsql as $$
declare
  v_uid    uuid := auth.uid();
  v_source text := wk_stage_move_source();
begin
  -- stage_moved_by is FK'd to profiles; an auth user with no profiles row
  -- would abort the whole drag-drop with a constraint violation.
  -- (profiles_self_read makes this EXISTS visible to the invoker.)
  if v_uid is not null and not exists (select 1 from profiles p where p.id = v_uid) then
    v_uid := null;
  end if;

  new.stage_move_source := v_source;
  new.stage_moved_from  := old.pipeline_column_id;
  new.stage_moved_at    := now();
  new.stage_moved_by    := case when v_source = 'agent' then v_uid else null end;
  return new;
end $$;

drop trigger if exists wk_contacts_stage_move_stamp on wk_contacts;
create trigger wk_contacts_stage_move_stamp
  before update of pipeline_column_id on wk_contacts
  for each row
  -- LOAD-BEARING: `UPDATE OF col` fires whenever the column is MENTIONED in the
  -- SET list, changed or not, and every EditContactModal save writes
  -- pipeline_column_id whether it changed or not. Without this, opening a lead
  -- and pressing Save would log a phantom move and reset the stamp.
  -- IS DISTINCT FROM also treats NULL -> first-ever-column as a real move.
  when (old.pipeline_column_id is distinct from new.pipeline_column_id)
  execute function wk_stamp_stage_move();

-- ── 4. AFTER: append to the lead timeline ───────────────────────────────────
-- SECURITY DEFINER: wk_activities_agent_rw's WITH CHECK is
-- (wk_is_admin() or agent_id = auth.uid()), so an agent_id = NULL insert from
-- an authenticated transaction would fail the check and abort the UPDATE the
-- agent just made. Same reason wk_touch_last_contact_at is SECURITY DEFINER.
create or replace function wk_log_stage_move() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_from text;
  v_to   text;
  v_by   text;
begin
  select name into v_from from wk_pipeline_columns where id = old.pipeline_column_id;
  select name into v_to   from wk_pipeline_columns where id = new.pipeline_column_id;
  select coalesce(nullif(btrim(p.name), ''), p.email)
    into v_by from profiles p where p.id = new.stage_moved_by;

  insert into wk_activities (contact_id, agent_id, kind, title, body, meta, ts)
  values (
    new.id,
    new.stage_moved_by,
    'stage_moved',
    'Moved to ' || coalesce(v_to, 'no stage'),
    'From ' || coalesce(v_from, 'no stage') ||
      case
        when new.stage_move_source = 'agent' and v_by is not null then ' · by ' || v_by
        when new.stage_move_source = 'automation'                 then ' · moved automatically'
        else ''
      end,
    -- Text snapshots as well as the uuids: the timeline must still read
    -- correctly after a pipeline column is renamed or deleted.
    jsonb_build_object(
      'from', old.pipeline_column_id, 'to', new.pipeline_column_id,
      'from_name', v_from, 'to_name', v_to,
      'source', new.stage_move_source, 'by_name', v_by
    ),
    new.stage_moved_at
  );
  return null;
end $$;

drop trigger if exists wk_contacts_stage_move_log on wk_contacts;
create trigger wk_contacts_stage_move_log
  after update of pipeline_column_id on wk_contacts
  for each row
  when (old.pipeline_column_id is distinct from new.pipeline_column_id)
  execute function wk_log_stage_move();

-- NOTE: wk_activities is deliberately NOT added to supabase_realtime. The board
-- already updates live off the wk_contacts event, which now carries the stamps;
-- publishing activities would fan every move, note and outcome to every tab.

-- ── 5. backfill stage_moved_at only, from evidence that already exists ──────
-- Marked source='backfill' so the UI says "recorded before tracking" and never
-- claims a precision it does not have. No wk_activities rows are synthesised —
-- inventing thousands of timeline entries with guessed times would poison the
-- real log.
--
-- Both statements deliberately omit pipeline_column_id from the SET list, so
-- neither trigger above fires.

-- 5a. real, agent-attributed moves from call dispositions (wk_apply_outcome).
with last_outcome as (
  select distinct on (a.contact_id)
         a.contact_id, a.agent_id, a.ts, (a.meta->>'column_id')::uuid as column_id
    from wk_activities a
   where a.kind = 'outcome_applied'
     and a.meta ? 'column_id'
     and (a.meta->>'column_id') ~ '^[0-9a-f-]{36}$'
   order by a.contact_id, a.ts desc
)
update wk_contacts c
   set stage_moved_at    = o.ts,
       stage_moved_by    = o.agent_id,
       stage_move_source = 'backfill'
  from last_outcome o
 where c.id = o.contact_id
   and c.stage_moved_at is null
   -- only claim it if the lead is STILL where that outcome put it
   and c.pipeline_column_id is not distinct from o.column_id;

-- 5b. the automatic funnel moves, reconstructed from the immutable VSL stamps.
with funnel_move as (
  select v.contact_id,
         greatest(
           coalesce(v.paid_at,             '-infinity'::timestamptz),
           coalesce(v.checkout_started_at, '-infinity'::timestamptz),
           coalesce(v.cta_clicked_at,      '-infinity'::timestamptz),
           coalesce(v.watched_at,          '-infinity'::timestamptz),
           coalesce(v.first_opened_at,     '-infinity'::timestamptz),
           coalesce(v.sent_at,             '-infinity'::timestamptz)
         ) as at
    from wk_vsl_pages v
)
update wk_contacts c
   set stage_moved_at    = f.at,
       stage_moved_by    = null,
       stage_move_source = 'backfill'
  from funnel_move f
 where c.id = f.contact_id
   and f.at > '-infinity'::timestamptz
   and c.stage_moved_at is null;
