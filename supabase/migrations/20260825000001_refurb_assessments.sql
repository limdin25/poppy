-- The refurb estimator's working copy of one house.
--
-- Before this table the estimator kept everything in localStorage on whichever
-- computer Pedro happened to be sitting at. That was fine while the input was
-- one man talking, and it stops being fine the moment the page also holds
-- listing photographs, two AI readings of them and a per-area confirmation the
-- whole quote depends on. Hugo asked for the agent to confirm every section;
-- a confirmation that dies with the browser tab is not a confirmation.
--
-- ONE ROW PER PROPERTY, on purpose. Two agents assessing the same house would
-- be two answers to "what does it need", and the builder can only be sent one.
--
-- `listing` is a CACHE of what Rightmove said, not a source of truth: photo
-- URLs, the blurb, the key features and the floor area, refetched when it goes
-- stale. It lives here rather than on brrr_properties because it is estimator
-- working data with a short life, and brrr_properties is read by the dialer,
-- the coach and the offer engine, none of which should start seeing it.
--
-- Admin-and-agent data reached only through api/crm/refurb-estimate.ts on the
-- service role, same as brrr_properties itself. RLS is ON with no policies, so
-- a stray anon or user key reads nothing at all.

create table if not exists public.brrr_refurb_assessments (
  property_id uuid primary key references public.brrr_properties(id) on delete cascade,

  -- Cached listing read (api/lib/rightmove-listing.ts), plus when it was read.
  listing jsonb,
  listing_fetched_at timestamptz,

  -- One entry per part of the property: the two readers' verdicts, the merged
  -- answer, the work lines, the agent's edits and his confirmation.
  areas jsonb not null default '[]'::jsonb,

  -- Which models read it and what they agreed on, kept so a bad estimate can
  -- be explained afterwards rather than argued about.
  analysis_meta jsonb,
  analysed_at timestamptz,

  -- Confirmed by the agent, because the listing's own figure is not a fact
  -- until somebody agrees with it (Hugo: "Any information fetched
  -- automatically from the listing must still be confirmed by the agent").
  address text,
  floor_area_sqm numeric(8,2),
  area_confirmed boolean not null default false,

  updated_at timestamptz not null default now(),
  updated_by uuid
);

create index if not exists brrr_refurb_assessments_updated_idx
  on public.brrr_refurb_assessments (updated_at desc);

alter table public.brrr_refurb_assessments enable row level security;
