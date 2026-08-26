-- Who came back to us, and nobody has answered them yet.
--
-- Hugo, 2026-08-26: "if someone calls us back it should show on the top, the
-- top stripe... whoever's called us, so he can click and go to the inbox. Or if
-- they have emailed us or SMS us. Only the people that we have contacted
-- before. No marketing emails."
--
-- WHY IT IS NOT wk_threads_awaiting_reply (20260822000001). That one is the
-- inbox's backlog list and it can only see MESSAGES. Measured on the live data
-- the day this shipped: in the previous fourteen days seven people came back to
-- us BY PHONE, five of them builders, four of those on the same morning, and
-- the app said nothing about any of them. JL Brickwork, the builder who nearly
-- walked off a viewing after the AI receptionist texted him, rang again at
-- 14:40 that afternoon and the only trace was a row in wk_calls. A returned
-- call from a builder we chased is worth more than the next cold dial, and it
-- was the one thing the app was silent about.
--
-- WHY INBOUND CALLS NEED A PHONE JOIN. wk_calls.contact_id is set on almost
-- nothing inbound: 14 of 145 over thirty days, because the leg arrives before
-- anyone knows who it is. So the caller is matched on from_e164 as well. There
-- are no duplicate phone numbers in wk_contacts (checked), so the match is
-- one-to-one today, and the final select dedupes by phone anyway.
--
-- WHAT KEEPS THE MARKETING OUT. Not a blocklist, a rule: something of OURS must
-- have gone to them BEFORE they came back. An outbound text, an outbound email,
-- or a dialled call, answered or not. A sender we have never contacted cannot
-- appear, so nothing has to be maintained as new spammers turn up.
--
-- WHAT PUTS ONE DOWN, and nothing here stores a boolean, for the reason argued
-- at length in the sibling migration:
--   * we text or email them back,
--   * we ring them and actually speak (>= 20s, so a ring-out is not an answer),
--   * a human presses Answered, which writes wk_thread_attention.handled_at.
-- All three are read-time comparisons, so no path can forget to clear a flag.
-- The suppression table is SHARED with the awaiting-reply list on purpose:
-- answering a builder in the inbox must take him off the banner too.

-- The index the inbound-call half rides on. Partial: inbound is a small slice.
create index if not exists wk_calls_inbound_from_created_idx
  on wk_calls (from_e164, created_at desc)
  where direction = 'inbound';

-- Outbound attempts, answered or not. The awaiting-reply migration indexed only
-- ANSWERED outbound calls, which is the wrong half for "did we contact them
-- first" — ringing somebody who did not pick up is still contacting them.
create index if not exists wk_calls_contact_outbound_created_idx
  on wk_calls (contact_id, created_at desc)
  where direction = 'outbound';

create or replace function wk_callbacks_open(p_hours numeric default 48)
returns table (
  contact_id       uuid,
  contact_name     text,
  contact_phone    text,
  lead_type        text,
  kind             text,          -- 'call' | 'sms' | 'whatsapp' | 'email'
  came_back_at     timestamptz,
  missed           boolean,       -- a call nobody picked up
  preview          text,
  last_outbound_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with theirs as (
    -- They messaged us.
    select
      m.contact_id,
      m.created_at                              as at,
      coalesce(m.channel, 'sms')                as kind,
      false                                     as missed,
      left(coalesce(m.body, ''), 300)           as preview
    from wk_sms_messages m
    where m.direction = 'inbound'
      and coalesce(m.status, '') <> 'discarded'
      and m.created_at >= now() - make_interval(hours => p_hours::int)
      and m.contact_id is not null

    union all

    -- They rang us. contact_id when the leg was matched, otherwise the number.
    select
      coalesce(c.contact_id, ct.id)             as contact_id,
      coalesce(c.started_at, c.created_at)      as at,
      'call'                                    as kind,
      (c.answered_at is null or coalesce(c.duration_sec, 0) < 5) as missed,
      ''                                        as preview
    from wk_calls c
    left join wk_contacts ct on ct.phone = c.from_e164
    where c.direction = 'inbound'
      and coalesce(c.started_at, c.created_at) >= now() - make_interval(hours => p_hours::int)
      and coalesce(c.contact_id, ct.id) is not null
  ),
  -- Anything of ours that ever went to them, at any time, answered or not.
  -- This is the "did we contact them first" test, nothing more.
  ever_ours as (
    select t.contact_id, min(t.at) as first_at
    from (
      select m.contact_id, m.created_at as at
      from wk_sms_messages m
      where m.direction = 'outbound'
        and coalesce(m.status, '') not in ('draft', 'discarded')
      union all
      select c.contact_id, coalesce(c.started_at, c.created_at)
      from wk_calls c
      where c.direction = 'outbound' and c.contact_id is not null
    ) t
    group by t.contact_id
  ),
  -- Anything of ours that COUNTS AS AN ANSWER. Narrower on purpose: a text we
  -- sent, or a call where somebody actually spoke.
  answered_by_us as (
    select t.contact_id, max(t.at) as last_at
    from (
      select m.contact_id, m.created_at as at
      from wk_sms_messages m
      where m.direction = 'outbound'
        and coalesce(m.status, '') not in ('draft', 'discarded')
      union all
      select c.contact_id, c.answered_at
      from wk_calls c
      where c.direction = 'outbound'
        and c.answered_at is not null
        and coalesce(c.duration_sec, 0) >= 20
    ) t
    group by t.contact_id
  ),
  newest as (
    select distinct on (th.contact_id)
      th.contact_id, th.at, th.kind, th.missed, th.preview
    from theirs th
    order by th.contact_id, th.at desc
  )
  select distinct on (coalesce(nullif(ct.phone, ''), ct.id::text))
    n.contact_id,
    ct.name,
    ct.phone,
    ct.custom_fields->>'lead_type',
    n.kind,
    n.at,
    n.missed,
    n.preview,
    ans.last_at
  from newest n
  join wk_contacts ct on ct.id = n.contact_id
  join ever_ours ours on ours.contact_id = n.contact_id
  left join answered_by_us ans on ans.contact_id = n.contact_id
  left join wk_thread_attention att on att.contact_id = n.contact_id
  where
    -- We spoke to them BEFORE they came back. Not a blocklist, a rule.
    ours.first_at < n.at
    -- Nobody has answered them since.
    and n.at > greatest(
      coalesce(ans.last_at, 'epoch'::timestamptz),
      coalesce(att.handled_at, 'epoch'::timestamptz)
    )
    -- A live snooze hides it, but something newer than the snooze re-arms it.
    and (
      att.snoozed_until is null
      or att.snoozed_until <= now()
      or n.at > att.snoozed_until
    )
    -- The retired creator funnel, excluded from the inbox the same way.
    and coalesce(ct.custom_fields->>'product', '') <> 'heypubli'
  order by coalesce(nullif(ct.phone, ''), ct.id::text), n.at desc
$$;

comment on function wk_callbacks_open(numeric) is
  'People we contacted first who have since called, texted or emailed us and have not been answered. Newest event per person. Shares wk_thread_attention with the awaiting-reply list, so pressing Answered in the inbox clears both.';

revoke all on function wk_callbacks_open(numeric) from public;
grant execute on function wk_callbacks_open(numeric) to authenticated, service_role;

-- REVERT (run by hand):
--   drop function if exists wk_callbacks_open(numeric);
--   drop index if exists wk_calls_inbound_from_created_idx;
--   drop index if exists wk_calls_contact_outbound_created_idx;
