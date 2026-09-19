-- The Auction desk: a second, clean CRM for Pedro (Hugo, 2026-09-18).
--
-- Hugo: "there's gonna be this second access, it's gonna be clean, no data
-- left there, nothing. He gonna use the same number, same email, but nothing
-- like any communication from the CRM he's using now." A toggle at the top of
-- the CRM switches between Houses (everything that exists today) and Auction
-- (unsold auction lots, rung at the auctioneer).
--
-- WHY A COLUMN AND NOT RLS. Everything in the CRM is scoped by AGENT, and Pedro
-- is one agent on one number in both desks, so no participation rule can tell
-- the desks apart. One label on the contact does: messages, follow-ups, inbox
-- state, assignments, queue rows and tags all hang off contact_id and inherit
-- it. wk_calls gets its own copy because an inbound call usually has no
-- contact_id when it is written.
--
-- EVERY DEFAULT IS 'houses', so every existing row, every existing query and
-- every existing caller of the two RPCs below behaves exactly as before.
--
-- THE INBOUND RULE, in one sentence: a known contact goes to its own desk, a
-- brand-new sender goes to whichever desk the agent is on at that moment
-- (profiles.active_desk). Hugo chose that an old contact's CALL does not ring
-- at all while Pedro is on Auction: it goes to voicemail and waits in Houses.

-- 1. The label -------------------------------------------------------------

alter table public.wk_contacts add column if not exists desk text not null default 'houses';
alter table public.wk_contacts drop constraint if exists wk_contacts_desk_chk;
alter table public.wk_contacts add constraint wk_contacts_desk_chk check (desk in ('houses', 'auction'));
create index if not exists wk_contacts_auction_desk_idx on public.wk_contacts (id) where desk = 'auction';

alter table public.wk_calls add column if not exists desk text not null default 'houses';
alter table public.wk_calls drop constraint if exists wk_calls_desk_chk;
alter table public.wk_calls add constraint wk_calls_desk_chk check (desk in ('houses', 'auction'));

alter table public.wk_dialer_campaigns add column if not exists desk text not null default 'houses';
alter table public.wk_dialer_campaigns drop constraint if exists wk_dialer_campaigns_desk_chk;
alter table public.wk_dialer_campaigns add constraint wk_dialer_campaigns_desk_chk check (desk in ('houses', 'auction'));

alter table public.wk_pipelines add column if not exists desk text not null default 'houses';
alter table public.wk_pipelines drop constraint if exists wk_pipelines_desk_chk;
alter table public.wk_pipelines add constraint wk_pipelines_desk_chk check (desk in ('houses', 'auction'));

-- An auction lot is a brrr_properties row like any house, so the Houses assign
-- script must be able to tell it apart and never deal it into the Houses queue.
alter table public.brrr_properties add column if not exists desk text not null default 'houses';
alter table public.brrr_properties drop constraint if exists brrr_properties_desk_chk;
alter table public.brrr_properties add constraint brrr_properties_desk_chk check (desk in ('houses', 'auction'));
-- The auction facts (house, office, lot, dates, guide, post-auction price,
-- price to beat, tenure, occupancy, legal pack) and the lot photos. Their own
-- columns, not hidden in `deal`, which is the valuation engine's output.
alter table public.brrr_properties add column if not exists auction jsonb;
alter table public.brrr_properties add column if not exists photo_urls text[] not null default '{}';

-- 2. Who may use which desk, and which one they are on --------------------

alter table public.profiles add column if not exists desks text[] not null default '{houses}';
alter table public.profiles add column if not exists active_desk text not null default 'houses';
alter table public.profiles drop constraint if exists profiles_active_desk_chk;
alter table public.profiles add constraint profiles_active_desk_chk check (active_desk in ('houses', 'auction'));

-- An agent may flip active_desk on their own row (profiles_self_update), but
-- may not grant themselves a desk, and may not stand on one they do not have.
create or replace function public.wk_profiles_guard_privileges()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- NOTE: this function is SECURITY DEFINER, so current_user would always be
  -- the function owner (postgres) and MUST NOT be used to detect the caller.
  -- session_user reflects the real login role (postgres/supabase_admin for
  -- direct SQL; 'authenticator' for all PostgREST traffic), and the JWT role
  -- distinguishes service_role from anon/authenticated over PostgREST.
  if session_user in ('postgres', 'supabase_admin')
     or (auth.jwt() ->> 'role') = 'service_role'
     or wk_is_admin() then
    return new;
  end if;
  new.workspace_role  := old.workspace_role;
  new.agent_extension := old.agent_extension;
  new.desks           := old.desks;
  if not (new.active_desk = any (new.desks)) then
    new.active_desk := old.active_desk;
  end if;
  return new;
end $function$;

-- 3. The two SECURITY DEFINER reads that bypass RLS take the desk -----------

drop function if exists public.wk_inbox_thread_previews(uuid);

create function public.wk_inbox_thread_previews(p_agent_id uuid default null, p_desk text default 'houses')
returns table (
  contact_id           uuid,
  last_body            text,
  last_at              timestamptz,
  last_direction       text,
  last_channel         text,
  last_media_urls      jsonb,
  last_subject         text,
  last_attachment_url  text,
  last_inbound_at      timestamptz,
  last_outbound_at     timestamptz,
  inbound_since_reply  int,
  sms_count            int,
  whatsapp_count       int,
  email_count          int,
  mailboxes            text[]
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with gate as (
    select
      (
        (p_agent_id is null and public.wk_is_admin())
        or (
          p_agent_id is not null
          and (auth.uid() = p_agent_id or public.wk_is_admin())
        )
      ) as ok
  ),
  allowed as (
    select distinct m.contact_id as id
    from wk_sms_messages m, gate
    where gate.ok
      and p_agent_id is null
      and coalesce(m.status, '') not in ('draft', 'discarded')
    union
    select c.id
    from wk_contacts c, gate
    where gate.ok
      and p_agent_id is not null
      and c.owner_agent_id = p_agent_id
    union
    select la.contact_id
    from wk_lead_assignments la, gate
    where gate.ok
      and p_agent_id is not null
      and la.agent_id = p_agent_id
      and la.status = any (array['assigned'::text, 'in_progress'::text])
    union
    select m.contact_id
    from wk_sms_messages m, gate
    where gate.ok
      and p_agent_id is not null
      and m.created_by = p_agent_id
      and m.contact_id is not null
    union
    select k.contact_id
    from wk_calls k, gate
    where gate.ok
      and p_agent_id is not null
      and k.agent_id = p_agent_id
      and k.contact_id is not null
    union
    select m.contact_id
    from wk_sms_messages m
    join wk_numbers n on (m.to_e164 = n.e164 or m.from_e164 = n.e164)
    join wk_number_agents na on na.number_id = n.id
    cross join gate
    where gate.ok
      and p_agent_id is not null
      and na.agent_id = p_agent_id
      and m.contact_id is not null
  ),
  -- THE DESK. Everything above decides who may see a thread; this decides
  -- which of the two CRMs it belongs to.
  in_desk as (
    select a.id
    from allowed a
    join wk_contacts c on c.id = a.id
    where c.desk = coalesce(p_desk, 'houses')
  ),
  scoped as (
    select m.*
    from wk_sms_messages m
    join in_desk a on a.id = m.contact_id
    where coalesce(m.status, '') not in ('draft', 'discarded')
  ),
  latest as (
    select distinct on (s.contact_id)
      s.contact_id,
      s.body,
      s.created_at,
      s.direction,
      s.channel,
      s.media_urls,
      s.subject,
      s.attachment_url
    from scoped s
    order by s.contact_id, s.created_at desc
  ),
  agg as (
    select
      s.contact_id,
      max(s.created_at) filter (where s.direction = 'inbound') as last_inbound_at,
      max(s.created_at) filter (where s.direction = 'outbound') as last_outbound_at,
      count(*) filter (where coalesce(s.channel, 'sms') = 'sms') as sms_count,
      count(*) filter (where s.channel = 'whatsapp') as whatsapp_count,
      count(*) filter (where s.channel = 'email') as email_count
    from scoped s
    group by s.contact_id
  ),
  waiting as (
    select
      s.contact_id,
      count(*)::int as inbound_since_reply
    from scoped s
    join agg a on a.contact_id = s.contact_id
    where s.direction = 'inbound'
      and (a.last_outbound_at is null or s.created_at > a.last_outbound_at)
    group by s.contact_id
  ),
  boxes as (
    select
      s.contact_id,
      array_agg(distinct lower(btrim(
        case when s.direction = 'inbound' then s.to_e164 else s.from_e164 end
      ))) as mailboxes
    from scoped s
    where s.channel = 'email'
      and btrim(coalesce(
        case when s.direction = 'inbound' then s.to_e164 else s.from_e164 end, '')) <> ''
    group by s.contact_id
  )
  select
    l.contact_id,
    l.body,
    l.created_at,
    l.direction,
    coalesce(l.channel, 'sms'),
    coalesce(to_jsonb(l.media_urls), '[]'::jsonb),
    l.subject,
    l.attachment_url,
    a.last_inbound_at,
    a.last_outbound_at,
    coalesce(w.inbound_since_reply, 0),
    a.sms_count::int,
    a.whatsapp_count::int,
    a.email_count::int,
    coalesce(b.mailboxes, array[]::text[])
  from latest l
  join agg a on a.contact_id = l.contact_id
  left join waiting w on w.contact_id = l.contact_id
  left join boxes b on b.contact_id = l.contact_id
  order by l.created_at desc
$$;

comment on function public.wk_inbox_thread_previews(uuid, text) is
  'One inbox row per contact the caller is allowed to see, in one desk (houses | auction). Latest real message, per-channel counts, and the mailboxes the thread used. p_agent_id null is admin-only (whole workspace).';

revoke all on function public.wk_inbox_thread_previews(uuid, text) from public, anon;
grant execute on function public.wk_inbox_thread_previews(uuid, text) to authenticated, service_role;

drop function if exists public.wk_callbacks_open(numeric);

create function public.wk_callbacks_open(p_hours numeric default 48, p_desk text default 'houses')
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
    -- The desk the strip is being drawn for. A builder ringing back while
    -- Pedro is on Auction waits on the Houses strip.
    ct.desk = coalesce(p_desk, 'houses')
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
  'People we contacted first who have since called, texted or emailed us and have not been answered, in one desk (houses | auction). Newest event per person. Shares wk_thread_attention with the awaiting-reply list, so pressing Answered in the inbox clears both.';

revoke all on function public.wk_callbacks_open(numeric, text) from public;
grant execute on function public.wk_callbacks_open(numeric, text) to authenticated, service_role;

-- 4. Seed: the Auction board, the Auction campaign, and Pedro's two desks ---
--
-- Column names never repeat a Houses name except Voicemail and No pickup, on
-- purpose. wk_apply_outcome recognises those two by NAME to requeue a lead to
-- the back, and both inbound voicemail lookups prefer the contact's own
-- pipeline first, so the pair behave exactly as they do on Houses. Every other
-- name is unique because several helpers look a column up by name across ALL
-- pipelines ('Ballpark agreed', 'Viewing booked', 'Not interested').

do $$
declare
  v_pipeline uuid;
  v_campaign uuid;
  v_pedro    uuid := '6b26172e-d98d-4cc4-9e22-b3b4e24624ee';
  v_number   uuid := '1a04cead-c768-46f4-8434-3ef94de7b6e3';
begin
  select id into v_pipeline from wk_pipelines where name = 'Auction' and desk = 'auction';
  if v_pipeline is null then
    insert into wk_pipelines (name, scope, desk) values ('Auction', 'auction', 'auction')
    returning id into v_pipeline;

    insert into wk_pipeline_columns
      (pipeline_id, name, colour, position, sort_order, requires_followup, is_terminal, is_default_on_timeout)
    values
      (v_pipeline, 'Lot: figure given',    '#B8860B', 0, 0, true,  false, false),
      (v_pipeline, 'Lot: call back',       '#2F8F9D', 1, 1, true,  false, false),
      (v_pipeline, 'Lot: viewing booked',  '#0EA5E9', 2, 2, true,  false, false),
      (v_pipeline, 'Lot: offer made',      '#7C5CBF', 3, 3, true,  false, false),
      (v_pipeline, 'Lot: bought',          '#166534', 4, 4, false, true,  false),
      (v_pipeline, 'Lot: sold elsewhere',  '#9CA3AF', 5, 5, false, true,  false),
      (v_pipeline, 'Lot: not suitable',    '#EF4444', 6, 6, false, true,  false),
      (v_pipeline, 'Voicemail',            '#F59E0B', 7, 7, true,  false, false),
      (v_pipeline, 'No pickup',            '#6B7280', 8, 8, false, true,  true);
  end if;

  select id into v_campaign from wk_dialer_campaigns where name = 'Auction - Pedro' and desk = 'auction';
  if v_campaign is null then
    insert into wk_dialer_campaigns (name, pipeline_id, parallel_lines, auto_advance_seconds, is_active, desk)
    values ('Auction - Pedro', v_pipeline, 1, 10, true, 'auction')
    returning id into v_campaign;
  end if;

  if exists (select 1 from profiles where id = v_pedro) then
    insert into wk_campaign_agents (campaign_id, agent_id, role)
    select v_campaign, v_pedro, 'agent'
    where not exists (select 1 from wk_campaign_agents where campaign_id = v_campaign and agent_id = v_pedro);

    update profiles set desks = array['houses', 'auction'] where id = v_pedro;
  end if;

  if exists (select 1 from wk_numbers where id = v_number) then
    insert into wk_campaign_numbers (campaign_id, number_id, priority)
    select v_campaign, v_number, 0
    where not exists (select 1 from wk_campaign_numbers where campaign_id = v_campaign and number_id = v_number);
  end if;
end $$;

-- Admins get both desks so Hugo can look at either. Admin is decided by
-- admin_users (wk_is_admin), not by workspace_role, which nobody has set.
update profiles set desks = array['houses', 'auction']
 where lower(email) in (select lower(email) from admin_users)
   and not ('auction' = any (desks));

-- REVERT (run by hand, in this order):
--   delete from wk_campaign_numbers where campaign_id in (select id from wk_dialer_campaigns where desk = 'auction');
--   delete from wk_campaign_agents  where campaign_id in (select id from wk_dialer_campaigns where desk = 'auction');
--   delete from wk_dialer_campaigns where desk = 'auction';
--   delete from wk_pipeline_columns where pipeline_id in (select id from wk_pipelines where desk = 'auction');
--   delete from wk_pipelines where desk = 'auction';
--   then re-apply 20260916000001 and 20260826000001 for the two functions, and
--   drop the desk / desks / active_desk / auction / photo_urls columns.
