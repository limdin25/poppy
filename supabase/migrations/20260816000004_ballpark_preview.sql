-- The machine runs the ballpark itself, and the result needs a home.
--
-- Hugo, 16 Aug: "Why didn't you fetch the ballpark already? You should have
-- said: Hugo, I have run the ballpark, those are the numbers, Pedro should
-- call Thursday. Confirm." So the deal sweep now runs the preview (hear the
-- call, extract, ask the engine) in the background and stores what came back
-- here, refusals included. The brain reads it and presents the DECISION; a
-- human press applies it. One run per state hash, so it cannot loop.

alter table brrr_properties add column if not exists ballpark_preview jsonb;

drop function if exists public.wk_deal_cockpit_rows(int);

create function public.wk_deal_cockpit_rows(p_limit int default 200)
returns table (
  property_id         uuid,
  address             text,
  status              text,
  asking_price        numeric,
  bedrooms            int,
  deal                jsonb,
  brief               jsonb,
  pinned_note         text,
  qualification       jsonb,
  floorplan_urls      jsonb,
  assigned_builder_id uuid,
  viewing_at          timestamptz,
  viewing_quote       numeric,
  property_updated_at timestamptz,
  listing_url         text,
  contact_id          uuid,
  contact_name        text,
  contact_phone       text,
  contact_email       text,
  custom_fields       jsonb,
  stage_moved_at      timestamptz,
  last_contact_at     timestamptz,
  column_name         text,
  calls               jsonb,
  messages            jsonb,
  followups           jsonb,
  last_conversation   jsonb,
  ballpark_preview    jsonb
)
language sql stable security definer set search_path = public as $$
  select
    p.id, p.address, p.status, p.asking_price, p.bedrooms,
    p.deal, p.brief, p.pinned_note, p.qualification, p.floorplan_urls,
    p.assigned_builder_id, p.viewing_at, p.viewing_quote, p.updated_at,
    p.listing_url,
    c.id, c.name, c.phone, c.email, c.custom_fields,
    c.stage_moved_at, c.last_contact_at,
    col.name,
    coalesce(cl.rows, '[]'::jsonb),
    coalesce(ms.rows, '[]'::jsonb),
    coalesce(fu.rows, '[]'::jsonb),
    lc.convo,
    p.ballpark_preview
  from brrr_properties p
  join wk_contacts c on c.id = p.wk_contact_id
  left join wk_pipeline_columns col on col.id = c.pipeline_column_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', k.id,
      'created_at', k.created_at,
      'direction', k.direction,
      -- The board column the agent dropped it into IS the outcome.
      'disposition', kcol.name,
      'duration_sec', k.duration_sec,
      -- Pedro's own words about the call. "call back monday" is an
      -- appointment the brain must respect, and it lives nowhere else.
      'agent_note', k.agent_note
    ) order by k.created_at desc) as rows
    from (
      select id, created_at, direction, duration_sec, disposition_column_id, agent_note
      from wk_calls
      where contact_id = c.id
      order by created_at desc
      limit 20
    ) k
    left join wk_pipeline_columns kcol on kcol.id = k.disposition_column_id
  ) cl on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', m.id,
      'created_at', m.created_at,
      'direction', m.direction,
      'channel', m.channel,
      'subject', m.subject,
      'body', m.body
    ) order by m.created_at desc) as rows
    from (
      -- The branch's own thread PLUS its satellites: same company domain,
      -- no properties of their own. This is how Lexi's rejection reaches
      -- Doug's deal.
      select id, created_at, direction, channel, subject, body
      from wk_sms_messages msg
      where msg.contact_id = c.id
         or msg.contact_id in (
           select c2.id
           from wk_contacts c2
           where c.email is not null and c.email <> ''
             and split_part(lower(c.email), '@', 2) not in (
               'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.co.uk',
               'outlook.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'aol.com',
               'live.com', 'live.co.uk', 'btinternet.com', 'sky.com', 'msn.com'
             )
             and c2.id <> c.id
             and c2.email is not null and c2.email <> ''
             and split_part(lower(c2.email), '@', 2) = split_part(lower(c.email), '@', 2)
             and not exists (
               select 1 from brrr_properties pb where pb.wk_contact_id = c2.id
             )
         )
      order by created_at desc
      limit 30
    ) m
  ) ms on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', f.id,
      'due_at', f.due_at,
      'note', f.note,
      'status', f.status
    ) order by f.due_at asc) as rows
    from wk_contact_followups f
    where f.contact_id = c.id
      and f.status in ('pending', 'snoozed')
  ) fu on true
  -- The newest call to this branch that has a transcript, with the whole
  -- transcript as one text. Speakers renamed at source so no reader ever has
  -- to know that 'agent' means Pedro and 'caller' means the branch.
  left join lateral (
    select jsonb_build_object(
      'call_id', lk.id,
      'at', lk.created_at,
      'duration_sec', lk.duration_sec,
      'note', lk.agent_note,
      'transcript', tx.lines
    ) as convo
    from (
      select k2.id, k2.created_at, k2.duration_sec, k2.agent_note
      from wk_calls k2
      where k2.contact_id = c.id
        and exists (select 1 from wk_live_transcripts t where t.call_id = k2.id)
      order by k2.created_at desc
      limit 1
    ) lk
    cross join lateral (
      select string_agg(
        (case when t.speaker = 'agent' then 'Pedro' else 'Branch' end)
          || ': ' || t.body,
        E'\n' order by t.ts
      ) as lines
      from wk_live_transcripts t
      where t.call_id = lk.id
    ) tx
  ) lc on true
  -- SECURITY DEFINER bypasses RLS, so THIS PREDICATE is the staff gate.
  --
  -- THE SERVICE ROLE HAS TO BE NAMED EXPLICITLY. wk_is_agent_or_admin() reads
  -- auth.uid() and the JWT email, and a server holds neither, so it returns
  -- FALSE for the service role. Without this clause api/cron/deal-sweep.ts
  -- would get zero rows on every run, forever, and report a clean sweep of
  -- nothing.
  --
  -- It grants nothing new. The service role key is server-only and already
  -- bypasses RLS on every table this function reads.
  where (auth.role() = 'service_role' or public.wk_is_agent_or_admin())
    -- A withdrawn house and a dead branch are not somebody's day. Everything
    -- else that has a branch attached is in play.
    and p.status not in ('auditor_killed', 'not_qualified')
  order by greatest(
    p.updated_at,
    coalesce(c.last_contact_at, p.updated_at)
  ) desc
  limit greatest(1, least(coalesce(p_limit, 200), 400));
$$;

revoke all on function public.wk_deal_cockpit_rows(int) from public, anon;
grant execute on function public.wk_deal_cockpit_rows(int) to authenticated;

comment on function public.wk_deal_cockpit_rows(int) is
  'Staff-gated. Every live property with its contact, board column, last 20 calls (with agent notes), last 30 messages (including SATELLITE contacts on the same company email domain), live follow-ups, and the transcript of the newest recorded call, in one round trip. Feeds buildDealState() for the Deal Cockpit.';

-- Hugo, on the DDM counter: "how confident are you on that?" The verdict now
-- says so, and it is kept with the assessment it belongs to.
alter table wk_deal_manager_log add column if not exists confidence text;
