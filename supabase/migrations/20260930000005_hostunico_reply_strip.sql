create or replace function public.wk_callbacks_open(p_hours numeric default 48, p_desk text default 'houses')
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
    select f.contact_id, f.replied_at as at,
      case when f.reply_kind='manual' then 'call' else coalesce(f.reply_kind,'sms') end as kind,
      false as missed, left(coalesce(f.reply_body,''),300) as preview
    from sa_report_followups f where f.replied_at is not null and f.intent <> 'negative'
    union all
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
    -- The desk the strip is being drawn for. A builder ringing back while
    -- Pedro is on Auction waits on the Houses strip.
    ct.desk = coalesce(p_desk, 'houses')
    and (ct.desk<>'sa' or (wk_is_agent_or_admin() and (wk_is_admin() or ct.owner_agent_id=auth.uid())))
    and not exists(select 1 from sa_report_followups f where f.contact_id=ct.id and f.intent='negative' and f.replied_at>=n.at)
    -- We spoke to them BEFORE they came back. Not a blocklist, a rule.
    and ours.first_at < n.at
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

comment on function public.wk_callbacks_open(numeric, text) is
  'Existing reply strip, including Hostunico replies and manually logged contact. Desk and owner scoped.';

revoke all on function public.wk_callbacks_open(numeric, text) from public;
grant execute on function public.wk_callbacks_open(numeric, text) to authenticated, service_role;

