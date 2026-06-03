-- Deal pipeline: editable, colourful stages + deals (sale opportunities worth £X,
-- linked to a contact and/or the conversation they came from). Turns the Leads
-- board into a RogerRoger-style pipeline.

-- ── pipeline stages (per business, renamable / recolourable / reorderable) ────
create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  color text not null default 'slate',   -- colour token, mapped to a tint in the UI
  sort_order int not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz default now()
);
alter table public.pipeline_stages enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'pipeline_stages' and policyname = 'ps_all') then
    create policy ps_all on public.pipeline_stages
      for all
      using (business_id in (select user_business_ids()))
      with check (business_id in (select user_business_ids()));
  end if;
end $$;
create index if not exists pipeline_stages_business_idx on public.pipeline_stages (business_id, sort_order);

-- ── deals ────────────────────────────────────────────────────────────────────
create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  stage_id uuid references public.pipeline_stages(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null,
  description text,
  value numeric(12,2) not null default 0,
  currency text not null default 'GBP',
  sort_order int not null default 0,
  owner_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.deals enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'deals' and policyname = 'deals_all') then
    create policy deals_all on public.deals
      for all
      using (business_id in (select user_business_ids()))
      with check (business_id in (select user_business_ids()));
  end if;
end $$;
create index if not exists deals_business_stage_idx on public.deals (business_id, stage_id);

-- ── seed a default 7-stage pipeline for every business ───────────────────────
insert into public.pipeline_stages (business_id, name, color, sort_order, is_won, is_lost)
select b.id, s.name, s.color, s.ord, s.won, s.lost
from public.businesses b
cross join (values
  ('Lead In',          'slate',   0, false, false),
  ('Contacted',        'blue',    1, false, false),
  ('Meeting Scheduled','violet',  2, false, false),
  ('Proposal Sent',    'amber',   3, false, false),
  ('Negotiation',      'orange',  4, false, false),
  ('Closed Won',       'emerald', 5, true,  false),
  ('Closed Lost',      'red',     6, false, true)
) as s(name, color, ord, won, lost)
where not exists (select 1 from public.pipeline_stages ps where ps.business_id = b.id);
