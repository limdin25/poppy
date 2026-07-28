-- Site demo funnel: one generated website per lead, at heyelsie.com/s/{slug}.
--
-- Standalone. Shares no table, no function and no pipeline column with the VSL
-- video funnel. The two are separate experiments and must be able to change
-- without touching each other.
--
-- WHY THERE IS NO PIPELINE-COLUMN BLOCK HERE
-- The VSL funnel appended six columns to the default workspace pipeline and
-- wrote wk_contacts.pipeline_column_id as leads moved. That destroyed the
-- agent's own call outcome on every lead it touched, and 20260727000009
-- unhijacked it: the columns are archived, the contacts restored, and
-- movePipelineCard() was deleted with a "do not re-add" note. The two axes are
-- now independent and stay that way. wk_contacts.pipeline_column_id is the
-- human's call outcome. wk_site_pages.state is the website's journey, and it
-- lives here, on this row, only. The Websites board reads it directly.

-- ============ pages ============
create table if not exists wk_site_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  contact_id uuid not null references wk_contacts(id) on delete cascade,
  agent_id uuid not null references profiles(id),
  -- set on conversion, and the thing the post-sale editor authorises against
  business_id uuid references businesses(id),
  template_key text not null default 'tableau',

  -- denormalised lead facts, so the page renders without a join and so a later
  -- edit to the contact cannot silently rewrite a site the lead already saw
  business_name text not null,
  owner_first text,
  trade_key text,
  trade_label text,
  town text,
  phone_display text,
  phone_e164 text,
  address text,

  -- the typed content document. One field here is one field in the owner's
  -- editor, which is why the fill step produces a document and not HTML.
  content jsonb not null default '{}'::jsonb,
  logo_url text,
  favicon_url text,
  chat_prompt text,

  -- COARSE AND FORWARD-ONLY. Nudges and outbound calls are deliberately NOT
  -- states: a lead who is nudged and then opens would have to move backwards,
  -- and 'nudged' would overwrite the fact that they opened. They are counters
  -- and timestamps below, and the board derives its "Nudging" and "AI calling"
  -- columns from those. Counts come from the *_at columns, never from state.
  state text not null default 'created'
    check (state in ('created','sent','opened','engaged','checkout_sent','converted')),

  sent_at timestamptz,
  first_click_at timestamptz,
  first_opened_at timestamptz,
  first_engaged_at timestamptz,
  checkout_sent_at timestamptz,
  converted_at timestamptz,
  last_nudge_at timestamptz,
  last_call_at timestamptz,

  open_count int not null default 0,
  click_count int not null default 0,
  chat_count int not null default 0,
  call_count int not null default 0,
  nudge_count int not null default 0,
  outbound_call_attempts int not null default 0,

  -- Per-stage ladder bookkeeping: {stage_key: {count, last_at}}.
  -- A single nudge counter is not enough. A lead nudged twice while the link
  -- sat unopened, who then opens, would look like they had already used up the
  -- "opened but not engaged" nudges and would never hear from us again. Each
  -- stage records itself, which also makes the cron idempotent: it writes this
  -- BEFORE enqueuing, so a redelivered cron tick cannot double-text.
  automation jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One site per lead. Also the guard that stops the reply classifier generating
-- a second site when a lead says "yes" twice.
create unique index if not exists wk_site_pages_contact_idx on wk_site_pages (contact_id);
create index if not exists wk_site_pages_state_idx on wk_site_pages (state, updated_at);
create index if not exists wk_site_pages_agent_idx on wk_site_pages (agent_id);

drop trigger if exists wk_site_pages_updated on wk_site_pages;
create trigger wk_site_pages_updated before update on wk_site_pages
  for each row execute function wk_set_updated_at();

alter table wk_site_pages enable row level security;

-- Agents read their own pages, admins read everything. There is no client write
-- policy at all: every write comes from a server route or the cron, on the
-- service role. A public page that anyone can load must never be writable by
-- the browser that loaded it.
drop policy if exists wk_site_pages_agent_read on wk_site_pages;
create policy wk_site_pages_agent_read on wk_site_pages for select
  using (wk_is_admin() or agent_id = auth.uid());

-- Realtime so the Websites board lights up as a lead opens the page.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'wk_site_pages'
  ) then
    alter publication supabase_realtime add table wk_site_pages;
  end if;
end $$;

-- ============ events ============
-- THE CHECK LIST MUST BE COMPLETE UP FRONT.
-- A value missing from this constraint fails the insert with 23514. The VSL
-- side learned this the expensive way: 'calc' beacons were rejected for weeks
-- and nobody noticed, because the insert result was never read. Every type this
-- feature will ever write in v1 is listed here, including the ones not wired up
-- until a later commit.
create table if not exists wk_site_events (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references wk_site_pages(id) on delete cascade,
  type text not null check (type in (
    'sent',            -- the link went out
    'link_click',      -- server-side, the page request itself
    'open',            -- browser beacon confirming a real render
    'phone_tap',       -- they tapped a tel: link
    'chat_message',    -- one per message, both roles, meta {role, text}
    'call_started',    -- meta {direction}
    'call_ended',      -- meta {direction, duration_sec}
    'followup_sent',   -- meta {stage}
    'outbound_call',   -- we placed an AI call, meta {attempt}
    'checkout_start',
    'converted'
  )),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wk_site_events_page_idx on wk_site_events (page_id, created_at);

alter table wk_site_events enable row level security;

drop policy if exists wk_site_events_agent_read on wk_site_events;
create policy wk_site_events_agent_read on wk_site_events for select
  using (
    wk_is_admin()
    or exists (select 1 from wk_site_pages p where p.id = page_id and p.agent_id = auth.uid())
  );

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'wk_site_events'
  ) then
    alter publication supabase_realtime add table wk_site_events;
  end if;
end $$;

-- ============ storage ============
-- Logo, favicon and photo uploads from the post-sale editor. Public read: these
-- are assets on a public website. Writes go through the server on the service
-- role, so no storage policy is needed here.
insert into storage.buckets (id, name, public)
  values ('site-assets', 'site-assets', true)
  on conflict (id) do nothing;

-- ============ state machine ============
create or replace function public.wk_site_rank(p_state text)
returns int
language sql
immutable
as $function$
  select case p_state
    when 'created'       then 0
    when 'sent'          then 1
    when 'opened'        then 2
    when 'engaged'       then 3
    when 'checkout_sent' then 4
    when 'converted'     then 5
    else -1
  end;
$function$;

create or replace function public.wk_site_advance(
  p_page_id uuid,
  p_target text default null,
  p_bump_open boolean default false,
  p_link_click boolean default false,
  p_phone_tap boolean default false,
  p_chat boolean default false,
  p_call boolean default false,
  p_nudge boolean default false,
  p_outbound_call boolean default false
)
returns table(
  state text, advanced boolean, contact_id uuid,
  first_click boolean, first_open boolean, first_chat boolean,
  first_call boolean, first_engage boolean
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r wk_site_pages%rowtype;
  v_advanced boolean := false;
  v_first_click boolean := false;
  v_first_open boolean := false;
  v_first_chat boolean := false;
  v_first_call boolean := false;
  v_first_engage boolean := false;
begin
  select * into r from wk_site_pages where id = p_page_id for update;
  if not found then return; end if;

  -- Everything below is computed from the LOCKED row, before the update. This
  -- is the only race-free place to decide "was this the first one?", and the
  -- answer is what makes each notification fire exactly once.
  --
  -- Derived from the COUNTERS, never the timestamps. A beacon is best-effort:
  -- one dropped sendBeacon leaves a timestamp NULL forever, and every later
  -- reload would then report itself as the first open. Counters are monotonic.
  v_first_click := p_link_click and r.click_count = 0;
  v_first_open  := p_bump_open  and r.open_count = 0;
  v_first_chat  := p_chat       and r.chat_count = 0;
  v_first_call  := p_call       and r.call_count = 0;
  -- Engagement is chat OR call, so the first of either is the moment that counts.
  v_first_engage := (p_chat or p_call) and r.chat_count = 0 and r.call_count = 0;

  if p_target is not null and wk_site_rank(p_target) > wk_site_rank(r.state) then
    r.state := p_target;
    v_advanced := true;
    r.sent_at          := coalesce(r.sent_at,          case when p_target='sent' then now() end);
    r.first_opened_at  := coalesce(r.first_opened_at,  case when p_target='opened' then now() end);
    r.first_engaged_at := coalesce(r.first_engaged_at, case when p_target='engaged' then now() end);
    r.checkout_sent_at := coalesce(r.checkout_sent_at, case when p_target='checkout_sent' then now() end);
    r.converted_at     := coalesce(r.converted_at,     case when p_target='converted' then now() end);
  end if;

  -- A signal can arrive when the state is already further along, or before it
  -- ever reached the matching state (a dropped open beacon, a click logged
  -- server-side first). Stamp from the signal too, so the board is never blank
  -- for a page that plainly has activity.
  if p_bump_open or p_phone_tap or p_chat or p_call then
    r.first_opened_at := coalesce(r.first_opened_at, now());
  end if;
  if p_chat or p_call then
    r.first_engaged_at := coalesce(r.first_engaged_at, now());
  end if;

  update wk_site_pages set
    state = r.state,
    sent_at = r.sent_at,
    first_opened_at = r.first_opened_at,
    first_engaged_at = r.first_engaged_at,
    checkout_sent_at = r.checkout_sent_at,
    converted_at = r.converted_at,
    first_click_at = coalesce(first_click_at, case when p_link_click then now() end),
    -- nudges and outbound calls never move state, they only stamp and count.
    -- The ladder reads these to decide what is due next.
    last_nudge_at = case when p_nudge then now() else last_nudge_at end,
    last_call_at  = case when p_outbound_call or p_call then now() else last_call_at end,
    open_count   = open_count   + (case when p_bump_open then 1 else 0 end),
    click_count  = click_count  + (case when p_link_click then 1 else 0 end),
    chat_count   = chat_count   + (case when p_chat then 1 else 0 end),
    call_count   = call_count   + (case when p_call then 1 else 0 end),
    nudge_count  = nudge_count  + (case when p_nudge then 1 else 0 end),
    outbound_call_attempts = outbound_call_attempts + (case when p_outbound_call then 1 else 0 end)
  where id = p_page_id;

  return query select
    r.state, v_advanced, r.contact_id,
    v_first_click, v_first_open, v_first_chat, v_first_call, v_first_engage;
end;
$function$;

-- NOT optional, and `authenticated` MUST be in the list.
--
-- Supabase ships ALTER DEFAULT PRIVILEGES granting EXECUTE on new functions to
-- `authenticated`. Revoking only public+anon would leave every logged-in
-- customer able to call a SECURITY DEFINER function that can set any page to
-- 'converted'. This bit us on the VSL side on 2026-07-27, where the same hole
-- meant any customer could mark any page 'paid'.
revoke all on function public.wk_site_advance(uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.wk_site_advance(uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean)
  to service_role;

revoke all on function public.wk_site_rank(text) from public, anon;
grant execute on function public.wk_site_rank(text) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- REVERT (run by hand):
--   drop function if exists public.wk_site_advance(uuid, text, boolean, boolean, boolean, boolean, boolean, boolean, boolean);
--   drop function if exists public.wk_site_rank(text);
--   drop table if exists wk_site_events;
--   drop table if exists wk_site_pages;
--   delete from storage.buckets where id = 'site-assets';
