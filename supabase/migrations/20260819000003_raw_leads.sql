-- The raw data command center.
--
-- Hugo, 2026-08-19: "Instead of piping leads straight to Pedro, everything
-- now hits a dedicated raw data tab in the CRM first. Asking price, three
-- distinct comparables with prices and distances, floor plans, the initial
-- discount right out of the gate, and a ballpark range minimum to maximum.
-- Multi-select and drag and drop so Hugo can manually approve and push
-- specific deals to the Pedro dialer."
--
-- This table holds the DISPLAY payload only. The queue mechanics stay where
-- they always were: the overnight assign scripts create contacts and
-- wk_dialer_queue rows exactly as before, but with status 'review', which
-- the dialer never selects. Hugo's push on the raw tab flips review to
-- pending. No money is computed here; discount and band arrive from the
-- engine's own export, read never derived.
--
-- comps:      [{"price": 112000, "distance_m": 140, "date": "2026-03",
--               "address": "431 West Dyke Road"}] (top 3, like-for-like)
-- floorplans: ["https://media.rightmove.co.uk/..."]
-- band_min/band_max: the engine's pre-call viable range (negotiating_band);
--               the maintenance detail stays tied to the live call.

create table if not exists wk_raw_leads (
  id uuid primary key default gen_random_uuid(),
  property_id text not null unique,
  contact_id uuid,
  kind text not null default 'discovery',
  address text,
  outcode text,
  asking_price numeric,
  discount numeric,
  band_min numeric,
  band_max numeric,
  comps jsonb not null default '[]'::jsonb,
  floorplans jsonb not null default '[]'::jsonb,
  url text,
  bedrooms int,
  property_type text,
  agent_name text,
  days_on_market int,
  scraped_at timestamptz,
  status text not null default 'pending_review',
  pushed_at timestamptz,
  pushed_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists wk_raw_leads_status_idx
  on wk_raw_leads (status, created_at desc);

alter table wk_raw_leads enable row level security;

-- Admins only. The raw tab IS the filter layer: agents receive leads after
-- the press, never browse the pool. The nightly writes arrive on the
-- service role, which bypasses RLS by design.
create policy wk_raw_leads_admin on wk_raw_leads
  for all using (wk_is_admin()) with check (wk_is_admin());
