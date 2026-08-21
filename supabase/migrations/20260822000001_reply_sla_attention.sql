-- Waiting on us: the thing that is true even after somebody has looked.
--
-- 2026-08-19. A builder was sent a WhatsApp viewing invite and replied two
-- minutes later agreeing to come AND asking a direct question, "could you
-- please send me the full address". Nobody answered him for FORTY-ONE HOURS.
-- He cancelled on the morning of the viewing. Two other builders replied "yes
-- I'm coming Monday 24 August" and were never answered either. On 21 August ten
-- threads had an inbound newer than our last outbound, some since 8 August.
--
-- The rule to spot it already existed in the client (inboxOrder.isThreadUnread)
-- and was ANDed with wk_inbox_state.last_read_at, which openThread() stamps on a
-- CLICK. So reading a message without answering it made it stop looking like it
-- needed an answer. That is the whole bug.
--
-- WHY NOTHING HERE STORES A BOOLEAN. The sibling migration for wk_inbox_state
-- argues it and the argument is stronger here: a stored `waiting` flag has to be
-- un-set by every path that could answer a thread (wk-sms-send, wk-email-send,
-- wk-draft-action, the jobs worker, the Twilio status webhook, an outbound
-- call). Miss one and the flag lies for ever, which is the class of failure this
-- exists to end. Two timestamps compared at read time cannot drift.
--
-- WHY THIS TABLE IS NOT A COLUMN ON wk_inbox_state. That table is deliberately
-- per-agent with no admin bypass, because a pin and an archive are personal.
-- "Pedro rang the builder back" is a fact about the THREAD. If it lived there,
-- Pedro pressing Answered would not clear Hugo's list, which is a silent
-- half-fix and worse than none.
--
-- KNOWN GAP, stated rather than silently got wrong: a branch that replies from a
-- SATELLITE contact row (see api/lib/satellite-contacts.ts, and the Lexi Collins
-- case where a rejection landed on an auto-created twin while the deal read "no
-- reply for two days") will not match, because this groups on contact_id alone.
-- The fix is to group on coalesce(satellite_of, contact_id) reusing the domain
-- logic in migration 20260816000003. Deliberately not done here: it widens the
-- blast radius of a first cut, and a missing thread is a smaller failure than a
-- wrong one.

-- ---------------------------------------------------------------------------
-- 1. The index the RPC lives on.
-- ---------------------------------------------------------------------------
create index if not exists wk_sms_messages_contact_dir_created_idx
  on wk_sms_messages (contact_id, direction, created_at desc);

-- Outbound calls that actually connected. Partial, because the set of answered
-- outbound calls is small next to the table.
create index if not exists wk_calls_contact_answered_idx
  on wk_calls (contact_id, answered_at desc)
  where direction = 'outbound' and answered_at is not null;

-- ---------------------------------------------------------------------------
-- 2. The only thing that can put a waiting thread down.
-- ---------------------------------------------------------------------------
create table if not exists wk_thread_attention (
  contact_id       uuid primary key references wk_contacts(id) on delete cascade,
  -- A human pressed "Answered". For what the machine cannot see: replied from a
  -- personal phone, sorted it in person. Suppresses ONLY while it is newer than
  -- their last message, so the next thing they send re-arms it by itself.
  handled_at       timestamptz,
  handled_by       uuid references profiles(id),
  handled_note     text,
  -- Put down until. Same self-healing rule: a message arriving during a snooze
  -- re-arms immediately.
  snoozed_until    timestamptz,
  snoozed_by       uuid references profiles(id),
  -- Cron bookkeeping, so ageing has a start and one noisy thread cannot alarm
  -- every ten minutes for ever.
  first_waiting_at timestamptz,
  last_alarm_at    timestamptz,
  alarm_count      int not null default 0,
  updated_at       timestamptz not null default now()
);

comment on table wk_thread_attention is
  'Workspace-wide suppression for the waiting-on-a-reply list. One row per contact. NOT per agent: answering a builder is a fact about the thread, not a personal view.';

alter table wk_thread_attention enable row level security;

-- Workspace-scoped, mirroring wk_contacts and NOT wk_inbox_state. Every agent in
-- the workspace can see and clear the same list, which is the entire point.
drop policy if exists wk_thread_attention_read on wk_thread_attention;
create policy wk_thread_attention_read on wk_thread_attention
  for select to authenticated using (true);

drop policy if exists wk_thread_attention_write on wk_thread_attention;
create policy wk_thread_attention_write on wk_thread_attention
  for insert to authenticated with check (true);

drop policy if exists wk_thread_attention_update on wk_thread_attention;
create policy wk_thread_attention_update on wk_thread_attention
  for update to authenticated using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. Snooze on the bell as well as on the thread.
-- ---------------------------------------------------------------------------
alter table wk_notifications add column if not exists snoozed_until timestamptz;

create index if not exists wk_notifications_active_idx
  on wk_notifications (agent_id, created_at desc) where read_at is null;

-- ---------------------------------------------------------------------------
-- 4. Who is waiting, and for how long.
-- ---------------------------------------------------------------------------
--
-- SECURITY DEFINER because the SLA cron needs the whole workspace and this is
-- read-only. The agent-facing inbox still intersects the result with its own
-- ownership-scoped rows, so an agent never sees another agent's lead name.
--
-- Ordered OLDEST FIRST. Recency is exactly the wrong order here: it buries the
-- 41 hour thread under one that arrived a minute ago.
-- p_require_outbound: only threads we have ACTUALLY SPOKEN TO at least once.
--
-- Measured on the live data the day this shipped: 118 threads had an inbound
-- newer than our last outbound, and 94 of them were conversations we had never
-- started. Marketing ("Take a sneak-peek"), portal welcome mail, auto-replies
-- ("Thanks for calling GGS Heating, we've got your message"), Elsie's own daily
-- report to Hugo, and old test rows. We do not owe any of them an answer, and
-- putting them on the list is how a list gets muted.
--
-- The remaining 24 are the real thing: 17 estate agents, 5 builders, 2 other.
--
-- It defaults TRUE because that is the list a person should be looking at.
-- Pass false for the honest everything, which the page offers as a second tab.
-- This is a rule about who we owe a reply to, not a blocklist of senders, so
-- nothing has to be maintained as new spammers appear.
create or replace function wk_threads_awaiting_reply(
  p_min_hours numeric default 0,
  p_require_outbound boolean default true
)
returns table (
  contact_id          uuid,
  last_inbound_at     timestamptz,
  last_outbound_at    timestamptz,
  last_outbound_call_at timestamptz,
  last_inbound_channel text,
  last_inbound_body   text,
  waiting_hours       numeric,
  handled_at          timestamptz,
  snoozed_until       timestamptz,
  first_waiting_at    timestamptz,
  last_alarm_at       timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with msg as (
    select
      m.contact_id,
      max(m.created_at) filter (where m.direction = 'inbound')  as last_in,
      -- A draft is not an answer. This filter must match the one the inbox uses
      -- or the two views disagree about the same thread.
      max(m.created_at) filter (
        where m.direction = 'outbound'
          and coalesce(m.status, '') not in ('draft', 'discarded')
      ) as last_out
    from wk_sms_messages m
    where coalesce(m.status, '') <> 'discarded'
    group by m.contact_id
  ),
  callback as (
    -- Ringing them back is answering them. 20 seconds, so a ring-out or a wrong
    -- number does not count as a conversation.
    select c.contact_id, max(c.answered_at) as last_call
    from wk_calls c
    where c.direction = 'outbound'
      and c.answered_at is not null
      and coalesce(c.duration_sec, 0) >= 20
    group by c.contact_id
  ),
  newest as (
    select distinct on (m2.contact_id) m2.contact_id, m2.channel, m2.body
    from wk_sms_messages m2
    where m2.direction = 'inbound'
    order by m2.contact_id, m2.created_at desc
  )
  select
    msg.contact_id,
    msg.last_in,
    msg.last_out,
    cb.last_call,
    newest.channel,
    left(coalesce(newest.body, ''), 400),
    round(extract(epoch from (now() - msg.last_in)) / 3600.0, 2),
    att.handled_at,
    att.snoozed_until,
    att.first_waiting_at,
    att.last_alarm_at
  from msg
  join wk_contacts ct on ct.id = msg.contact_id
  left join callback cb on cb.contact_id = msg.contact_id
  left join newest on newest.contact_id = msg.contact_id
  left join wk_thread_attention att on att.contact_id = msg.contact_id
  where msg.last_in is not null
    -- They spoke last, on any channel, and we have not answered by message,
    -- by phone, or by pressing Answered.
    and msg.last_in > greatest(
      coalesce(msg.last_out, 'epoch'::timestamptz),
      coalesce(cb.last_call, 'epoch'::timestamptz),
      coalesce(att.handled_at, 'epoch'::timestamptz)
    )
    -- A live snooze hides it, but a message newer than the snooze re-arms it.
    and (
      att.snoozed_until is null
      or att.snoozed_until <= now()
      or msg.last_in > att.snoozed_until
    )
    -- The retired creator funnel. Its threads are excluded from the inbox the
    -- same way; including them here would put 1,386 dead conversations at the
    -- top of the list on day one.
    and coalesce(ct.custom_fields->>'product', '') <> 'heypubli'
    and extract(epoch from (now() - msg.last_in)) / 3600.0 >= p_min_hours
    -- See the note above the signature: a conversation we never started is not
    -- one we are late on.
    and (not p_require_outbound or msg.last_out is not null)
  order by msg.last_in asc
$$;

comment on function wk_threads_awaiting_reply(numeric, boolean) is
  'Threads where the lead spoke last and nobody has answered by message, by phone, or by pressing Answered. Oldest wait first. Read-only. p_require_outbound (default true) keeps it to conversations we actually started.';

revoke all on function wk_threads_awaiting_reply(numeric, boolean) from public;
grant execute on function wk_threads_awaiting_reply(numeric, boolean) to authenticated, service_role;

-- REVERT (run by hand):
--   drop function if exists wk_threads_awaiting_reply(numeric, boolean);
--   drop function if exists wk_threads_awaiting_reply(numeric);
--   drop table if exists wk_thread_attention;
--   alter table wk_notifications drop column if exists snoozed_until;
--   drop index if exists wk_sms_messages_contact_dir_created_idx;
--   drop index if exists wk_calls_contact_answered_idx;
--   drop index if exists wk_notifications_active_idx;
