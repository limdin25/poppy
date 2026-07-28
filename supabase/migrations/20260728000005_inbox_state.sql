-- Inbox state: read / pinned / archived, one row per (agent, lead).
--
-- Hugo, 2026-07-28: "make sure unread is always on top, even if we have blasted
-- messages. When it's unread the colour is different. Add a button to archive
-- and a button to pin, and a filter for drafts."
--
-- Why a table and not a column on wk_contacts. Two agents share a workspace and
-- can both be looking at the same lead. Read state, a pin and an archive are
-- personal: Maria archiving a thread must not hide it from Pedro. The primary
-- key is (agent_id, contact_id) so each agent carries their own view.
--
-- Nothing is seeded. A missing row means "never read, not pinned, not
-- archived", which is the correct day-one state for every existing thread.
--
-- Unread itself is NOT stored. It is derived in the client from the messages
-- already loaded: a thread is unread when its newest inbound message is newer
-- than both last_read_at and the newest message the agent actually sent. That
-- keeps it self-healing (a replied-to thread is read even with no row here) and
-- means an unread badge can never get stuck on.

create table if not exists wk_inbox_state (
  agent_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  contact_id   uuid not null references wk_contacts(id) on delete cascade,
  -- When this agent last opened the thread. Written on a deliberate click,
  -- never on the inbox auto-selecting the top row, so a reply can't be marked
  -- read by a page load nobody looked at.
  last_read_at timestamptz,
  pinned_at    timestamptz,
  archived_at  timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (agent_id, contact_id)
);

comment on table wk_inbox_state is
  'Per-agent CRM inbox state: last_read_at, pinned_at, archived_at. Unread is derived client-side from message timestamps, not stored.';

-- Partial indexes: the pinned and archived sets are tiny next to the full table.
create index if not exists wk_inbox_state_pinned_idx
  on wk_inbox_state (agent_id) where pinned_at is not null;
create index if not exists wk_inbox_state_archived_idx
  on wk_inbox_state (agent_id) where archived_at is not null;

alter table wk_inbox_state enable row level security;

-- Strictly personal. No admin bypass on purpose: an admin reading everyone
-- else's pins would put another agent's archive in their own sidebar.
drop policy if exists wk_inbox_state_own on wk_inbox_state;
create policy wk_inbox_state_own on wk_inbox_state
  for all to authenticated
  using (agent_id = auth.uid())
  with check (agent_id = auth.uid());

grant select, insert, update, delete on wk_inbox_state to authenticated;

drop trigger if exists wk_inbox_state_set_updated_at on wk_inbox_state;
create trigger wk_inbox_state_set_updated_at
  before update on wk_inbox_state
  for each row execute function wk_set_updated_at();
