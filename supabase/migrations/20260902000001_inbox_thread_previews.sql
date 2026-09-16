-- Inbox list: one latest message per contact, not the last 1000 rows
-- workspace-wide.
--
-- 2026-09-02. useInboxThreads fetched newest 1000 wk_sms_messages across
-- EVERYBODY, then filtered to the agent in memory. The comment in
-- useAwaitingReply already named the hole: a builder thread whose newest
-- row is 1001 vanishes from the sidebar. Pedro's inbox is filling with
-- Rightmove / LinkedIn / Skool mail, so a quote from this morning is the
-- next thing that drops off. Haydon and Sycamore both arrived today and
-- Hugo could not find the PDF. This RPC is the list.
--
-- SECURITY DEFINER: wk_sms_messages SELECT is open to any CRM role
-- (PR 52), and ownership filtering has always been the app's job. The
-- predicate below is the gate. An agent can only ask for themselves.
-- An admin can ask for themselves, for another agent (See as), or for
-- the whole workspace (p_agent_id null).
--
-- Participation matches useInboxThreads as it stood: owner, active
-- assignment, created_by, called, or a message on one of their numbers.
-- created_by is the extra arm the client had that wk_agent_participates
-- does not. Keep both, or a thread they texted but do not own disappears.

create index if not exists wk_sms_messages_contact_created_idx
  on wk_sms_messages (contact_id, created_at desc);

create or replace function public.wk_inbox_thread_previews(p_agent_id uuid default null)
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
  email_count          int
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
    -- Admin, whole workspace: every contact that already has a real message.
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
  scoped as (
    select m.*
    from wk_sms_messages m
    join allowed a on a.id = m.contact_id
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
    a.email_count::int
  from latest l
  join agg a on a.contact_id = l.contact_id
  left join waiting w on w.contact_id = l.contact_id
  order by l.created_at desc
$$;

comment on function public.wk_inbox_thread_previews(uuid) is
  'One inbox row per contact the caller is allowed to see. Latest real message, not a workspace-wide last-1000 slice. p_agent_id null is admin-only (whole workspace).';

revoke all on function public.wk_inbox_thread_previews(uuid) from public, anon;
grant execute on function public.wk_inbox_thread_previews(uuid) to authenticated, service_role;
