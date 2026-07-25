-- VSL funnel: per-lead personalized video pages (heyelsie.com/{slug}) with
-- watch/click/pay tracking, SMS automation state, and pipeline auto-move.
-- Hugo 2026-07-25. The video file itself arrives later — video_url is a slot.

-- ============ pages ============
create table if not exists wk_vsl_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  contact_id uuid not null references wk_contacts(id) on delete cascade,
  agent_id uuid not null references profiles(id),
  business_name text not null,
  owner_first text,
  town text,
  video_url text,
  og_image_url text,
  -- A/B of the button label; assigned at creation, reported by clicks.
  cta_variant text not null default 'a' check (cta_variant in ('a','b')),
  -- Forward-only funnel state; api/vsl/track.ts is the only mover.
  state text not null default 'created' check (state in
    ('created','sent','opened','watched','cta_clicked','checkout_started','paid')),
  sent_at timestamptz,
  first_opened_at timestamptz,
  watched_at timestamptz,
  cta_clicked_at timestamptz,
  checkout_started_at timestamptz,
  paid_at timestamptz,
  watched_pct int not null default 0,
  open_count int not null default 0,
  -- Per-automation-rule fired bookkeeping: { rule_key: { count, last_at } }
  automation jsonb not null default '{}'::jsonb,
  business_id uuid references businesses(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists wk_vsl_pages_contact_idx on wk_vsl_pages (contact_id);
create index if not exists wk_vsl_pages_state_idx on wk_vsl_pages (state, updated_at);
create index if not exists wk_vsl_pages_agent_idx on wk_vsl_pages (agent_id);

drop trigger if exists wk_vsl_pages_set_updated_at on wk_vsl_pages;
create trigger wk_vsl_pages_set_updated_at
  before update on wk_vsl_pages
  for each row execute function wk_set_updated_at();

alter table wk_vsl_pages enable row level security;

-- Agents read their own pages; admins everything. All writes are service-role
-- (public endpoints + cron) so no client write policy exists at all.
drop policy if exists wk_vsl_pages_agent_read on wk_vsl_pages;
create policy wk_vsl_pages_agent_read on wk_vsl_pages for select
  using (wk_is_admin() or agent_id = auth.uid());

-- Realtime: the funnel board highlights "watching now" as beacons land.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'wk_vsl_pages'
  ) then
    alter publication supabase_realtime add table wk_vsl_pages;
  end if;
end $$;

-- ============ events ============
create table if not exists wk_vsl_events (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references wk_vsl_pages(id) on delete cascade,
  type text not null check (type in
    ('open','progress','cta_click','tier_pick','checkout_start','paid','auto_sms')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wk_vsl_events_page_idx on wk_vsl_events (page_id, created_at);

alter table wk_vsl_events enable row level security;

drop policy if exists wk_vsl_events_agent_read on wk_vsl_events;
create policy wk_vsl_events_agent_read on wk_vsl_events for select
  using (
    wk_is_admin()
    or exists (select 1 from wk_vsl_pages p where p.id = page_id and p.agent_id = auth.uid())
  );

-- ============ pipeline columns ============
-- Six funnel columns appended to the default workspace pipeline so every lead's
-- exact position is visible on the existing board (threads/calls drawer and
-- admin-sees-all come for free). Auto-move is forward-only; Paid is terminal.
do $$
declare
  pid uuid;
  base int;
begin
  select id into pid from wk_pipelines order by created_at limit 1;
  if pid is null then return; end if;
  select coalesce(max(position), -1) + 1 into base from wk_pipeline_columns where pipeline_id = pid;

  insert into wk_pipeline_columns (pipeline_id, name, colour, position, sort_order, is_terminal)
  select pid, v.name, v.colour, base + v.off, base + v.off, v.terminal
  from (values
    ('Video sent',       '#0EA5E9', 0, false),
    ('Opened page',      '#38BDF8', 1, false),
    ('Watched video',    '#F59E0B', 2, false),
    ('Clicked button',   '#F97316', 3, false),
    ('Checkout started', '#A855F7', 4, false),
    ('Paid',             '#16A34A', 5, true)
  ) as v(name, colour, off, terminal)
  where not exists (
    select 1 from wk_pipeline_columns c where c.pipeline_id = pid and c.name = v.name
  );
end $$;
