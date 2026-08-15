-- The Deal Cockpit's memory: every move the machine makes, and every move a
-- human makes after it.
--
-- Hugo, 2026-08-15: "a dedicated log column showing the full history and
-- reasoning for every move." docs/AI_DEAL_MANAGER_PLAN.md section 7 phase 0
-- asked for the same table under the name wk_deal_manager_log, so this is that
-- table, built at last.
--
-- ONE EVENT STREAM, NOT TWO TABLES. The cockpit's right-hand column is then a
-- single ordered read, and the interleaving IS the story: the machine assessed,
-- Pedro pressed, the stress test refused, Hugo wrote down why. Two tables would
-- force the page to page two streams and merge-sort them, and an assessment row
-- and an action row already share most of their columns. `kind` says which.
--
-- WHY `state` IS COPIED AND NEVER JOINED. A deal is re-priced every night. A
-- join would show today's log entry beside next week's numbers, and the
-- reasoning would silently stop matching the words it was written about. Same
-- decision, same reason, as brrr_price_feedback.

create table if not exists public.wk_deal_manager_log (
  id          uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.brrr_properties(id) on delete cascade,
  contact_id  uuid references public.wk_contacts(id) on delete set null,

  -- WHAT KIND OF EVENT THIS IS.
  --   assessment       the machine looked and decided
  --   fallback_refused the machine was off, down, or said something out of
  --                    bounds, so the deterministic brief stands
  --   action_executed  a human pressed a button and it went through
  --   action_blocked   a human pressed a button and the stress test refused
  --   human_note       somebody wrote something down
  kind text not null check (kind in (
    'assessment', 'fallback_refused', 'action_executed', 'action_blocked', 'human_note'
  )),

  -- WHY IT RAN. Closed list, mirrored in api/lib/deal-manager-run.ts.
  trigger text check (trigger in (
    'outcome_pressed', 'inbound_message', 'followup_due', 'price_refresh',
    'morning_sweep', 'sweep', 'manual', 'button'
  )),

  -- WHAT WAS DECIDED (assessment rows) or WHAT WAS PRESSED (action rows).
  action      text,
  who         text check (who in ('PEDRO', 'HUGO', 'VA', 'NOBODY')),
  attention   int check (attention between 0 and 100),
  instruction text,
  flags       text[] not null default '{}',
  evidence    text[] not null default '{}',

  -- WHAT IT WAS LOOKING AT WHEN IT DECIDED.
  board_column text,
  state_hash   text,
  state        jsonb,

  -- HOW IT WENT.
  source         text not null default 'fallback'
                   check (source in ('manager', 'fallback', 'human')),
  refused_reason text,
  model          text,
  latency_ms     int,

  -- THE STRESS TEST, frozen alongside the row it gated, so a refusal can still
  -- be read back months later against the checks that caused it.
  checks  jsonb,
  blocked boolean not null default false,

  -- ACTION ROWS ONLY.
  actor_id    uuid references public.profiles(id) on delete set null,
  executed_by text check (executed_by in ('server', 'client')),
  result      jsonb,
  note        text,

  created_at timestamptz not null default now()
);

comment on table public.wk_deal_manager_log is
  'One ordered event stream per deal: every assessment, every fallback, every button pressed and every button refused, with the DealState it rested on frozen alongside. Read by the Deal Cockpit''s history column. The state is copied, never joined, because deals are re-priced nightly.';
comment on column public.wk_deal_manager_log.state is
  'The whole DealState the machine was shown, frozen. If a figure is not in here the machine never saw it, which is what makes the figure fence checkable rather than hopeful.';
comment on column public.wk_deal_manager_log.state_hash is
  'FNV-1a over the canonical state, with every hours-since float dropped. Same hash means nothing has actually changed, so no second assessment and no second spend.';
comment on column public.wk_deal_manager_log.checks is
  'The stress test report as it read at the moment the button was pressed. Frozen for the same reason as state.';

-- The history column: one property, newest first.
create index if not exists wk_deal_manager_log_property_idx
  on public.wk_deal_manager_log (property_id, created_at desc);

-- The daily budget count, and the global feed.
create index if not exists wk_deal_manager_log_created_idx
  on public.wk_deal_manager_log (created_at desc);

-- "The newest assessment per property", which is how the cockpit list gets its
-- instructions with ZERO model calls on a page load.
create index if not exists wk_deal_manager_log_latest_assessment_idx
  on public.wk_deal_manager_log (property_id, created_at desc)
  where kind in ('assessment', 'fallback_refused');

-- The dedupe lookup.
create index if not exists wk_deal_manager_log_hash_idx
  on public.wk_deal_manager_log (property_id, state_hash)
  where kind = 'assessment';

alter table public.wk_deal_manager_log enable row level security;

-- HUGO'S LANE IS A DATABASE FACT, NOT A UI FILTER.
--
-- AI_DEAL_MANAGER_PLAN section 3: "Anything flagged blocked_needs_hugo,
-- figure_mismatch or stage_mismatch surfaces to Hugo only. The Manager
-- escalates, it never resolves." Pedro is never shown a problem he cannot fix,
-- and putting that in RLS rather than in a `.filter()` means a future page that
-- forgets the filter still cannot leak it.
drop policy if exists wk_deal_manager_log_read on public.wk_deal_manager_log;
create policy wk_deal_manager_log_read on public.wk_deal_manager_log
  for select to authenticated
  using (
    wk_is_agent_or_admin()
    and (
      wk_is_admin()
      or not (flags && array['blocked_needs_hugo', 'figure_mismatch', 'stage_mismatch'])
    )
  );

drop policy if exists wk_deal_manager_log_admin_all on public.wk_deal_manager_log;
create policy wk_deal_manager_log_admin_all on public.wk_deal_manager_log
  for all to authenticated
  using (wk_is_admin()) with check (wk_is_admin());

-- NO INSERT POLICY FOR `authenticated`, ON PURPOSE. Every write goes through
-- api/crm/cockpit-action.ts or api/cron/deal-sweep.ts on the service role, and
-- both of those run the stress test first. A browser that could write here
-- could write a log entry saying an offer was approved.

-- ---------------------------------------------------------------------------
-- The cockpit's one read.
-- ---------------------------------------------------------------------------
--
-- WHY THIS EXISTS. api/crm/deal-manager.ts loads its Today list by looping one
-- property at a time, five queries each, up to 400 properties. That is fine for
-- a panel that is refreshed by hand and hopeless for a page somebody sits in
-- all day. This returns the same information in one round trip.
--
-- The three histories come back as jsonb ARRAYS rather than aggregates, because
-- buildDealState() in api/lib/deal-state.ts already takes arrays and computes
-- the aggregates itself. Returning counts instead would mean a second place
-- deciding what "the last touch" is, and two places deciding one fact is the
-- bug this codebase keeps having.
--
-- NOTE ON CALL OUTCOMES: wk_calls has NO `disposition` column. The outcome of a
-- call is disposition_column_id, a foreign key to the board column the agent
-- dropped it into, so the name has to be resolved by a join. Selecting a column
-- called `disposition` returns an error and an empty list, silently.

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
  followups           jsonb
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
    coalesce(fu.rows, '[]'::jsonb)
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
      'duration_sec', k.duration_sec
    ) order by k.created_at desc) as rows
    from (
      select id, created_at, direction, duration_sec, disposition_column_id
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
      select id, created_at, direction, channel, subject, body
      from wk_sms_messages
      where contact_id = c.id
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
  -- SECURITY DEFINER bypasses RLS, so THIS PREDICATE is the staff gate.
  --
  -- THE SERVICE ROLE HAS TO BE NAMED EXPLICITLY. wk_is_agent_or_admin() reads
  -- auth.uid() and the JWT email, and a server holds neither, so it returns
  -- FALSE for the service role. Without this clause api/cron/deal-sweep.ts
  -- would get zero rows on every run, forever, and report a clean sweep of
  -- nothing. That is not a hypothetical: the same shape of silent empty result
  -- is what hid the missing wk_calls.disposition column for weeks.
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
  'Staff-gated. Every live property that has an estate agency branch attached, with its contact, board column, last 20 calls, last 30 messages and live follow-ups, in one round trip. Feeds buildDealState() for the Deal Cockpit. Calls carry their disposition COLUMN NAME, because wk_calls has no disposition column of its own.';
