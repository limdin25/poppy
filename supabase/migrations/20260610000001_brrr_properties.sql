-- BRRR property qualifier: properties sent over from Hugo's Rightmove scraper,
-- plus the outbound qualification-call queue.
-- Admin-only tables — no RLS, accessed only via service role through API routes
-- (same pattern as the admin_* tables).

create table if not exists public.brrr_properties (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'rightmove',
  source_property_id text not null,
  listing_url text,
  address text,
  price_text text,                    -- e.g. "£65,000" as scraped
  asking_price numeric(12,2),
  price_qualifier text,               -- "Guide Price" / "Offers Over" / ...
  bedrooms int,
  property_type text,
  floor_area_sqm numeric(8,2),
  floor_area_sqft numeric(8,2),
  days_on_market text,
  agent_name text,
  agent_phone text,                   -- E.164 normalised on ingest
  agent_branch_url text,
  floorplan_urls jsonb default '[]',
  comps jsonb default '[]',           -- raw comps rows from the scraper
  deal jsonb default '{}',            -- calculator snapshot: offer_price, gdv, refurb, rent, total_cash, verdict
  status text not null default 'new', -- new | call_queued | calling | qualified | not_qualified | no_answer | callback
  qualification jsonb default '{}',   -- extracted answers from the call
  notes text,
  deal_id uuid references public.deals(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (source, source_property_id)
);

create index if not exists brrr_properties_status_idx
  on public.brrr_properties (status, created_at desc);

create table if not exists public.brrr_property_calls (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.brrr_properties(id) on delete cascade,
  status text not null default 'pending',  -- pending | dialing | completed | failed | no_answer
  attempts int not null default 0,
  next_attempt_at timestamptz default now(),
  retell_call_id text,
  transcript jsonb,
  recording_url text,
  summary text,
  qualification jsonb default '{}',
  error text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists brrr_property_calls_pending_idx
  on public.brrr_property_calls (status, next_attempt_at);
create index if not exists brrr_property_calls_retell_idx
  on public.brrr_property_calls (retell_call_id);
