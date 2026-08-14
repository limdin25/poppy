-- What to do next with this house, in writing, on the house itself.
--
-- Hugo, 2026-08-14: "build the brain that always after the call gets the
-- exactly instruction for the next step for me to read, so after call fires and
-- confirm whats next step with confidence."
--
-- Two columns, and they are deliberately different things:
--
--   brief        THE BRAIN'S. Rewritten after every property call from the
--                outcome, the answers and the deal engine's own figures. Never
--                edited by a human, so it is always current or absent.
--   pinned_note  HUGO'S OWN WORDS. Sticky, survives every re-scrape and every
--                call, and is shown ABOVE the brief because a human decision
--                outranks a generated one. This is where "the agent will not
--                put the offer forward without proof of funds" lives.
--
-- Neither goes in `notes`: that column already holds the scraper's listing
-- description, and the nightly ingest upsert would bury a human note under a
-- property blurb the first time the house was re-sent.

alter table brrr_properties
  add column if not exists brief       jsonb,
  add column if not exists pinned_note text;

comment on column brrr_properties.brief is
  'The next-step brief, written by api/lib/next-step-brief.ts after every property call. Deterministic: outcome + answers + the deal engine figures. Replaced whole each time.';
comment on column brrr_properties.pinned_note is
  'Hugo''s own instruction for this house. Never machine-written, never overwritten by a re-scrape, shown above the brief.';

-- The dialer reads listings through this RPC and nothing else (brrr_properties
-- has no RLS and is service-role only), so both columns have to be projected
-- here or Pedro cannot see a word of it. Everything else is unchanged from
-- 20260811000002, including the best-deal-first order.

-- DROP first: adding a column to `returns table` changes the row type, and
-- Postgres refuses to replace a function whose OUT parameters have changed.
-- The revoke at the bottom is load-bearing for the same reason it was on
-- wk_vsl_advance: this is SECURITY DEFINER, and a fresh function is EXECUTE to
-- public until told otherwise.
drop function if exists public.wk_property_agent_listings(text);

create function public.wk_property_agent_listings(p_phone text)
returns table (
  id                 uuid,
  source_property_id text,
  listing_url        text,
  address            text,
  price_text         text,
  asking_price       numeric,
  bedrooms           int,
  property_type      text,
  days_on_market     text,
  floorplan_urls     jsonb,
  deal               jsonb,
  status             text,
  qualification      jsonb,
  notes              text,
  call_channel       text,
  agent_name         text,
  agent_phone        text,
  offer_low_pct      numeric,
  offer_high_pct     numeric,
  last_call_at       timestamptz,
  last_call_channel  text,
  last_call_summary  text,
  brief              jsonb,
  pinned_note        text
)
language sql stable security definer set search_path = public as $$
  with pct as (
    select
      coalesce((value::jsonb ->> 'offer_low_pct')::numeric, 70)  as low,
      coalesce((value::jsonb ->> 'offer_high_pct')::numeric, 75) as high
    from platform_settings
    where key = 'brrr_settings'
    limit 1
  ),
  tail as (
    select right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9) as t
  )
  select
    p.id, p.source_property_id, p.listing_url, p.address, p.price_text,
    p.asking_price, p.bedrooms, p.property_type, p.days_on_market,
    p.floorplan_urls, p.deal, p.status, p.qualification, p.notes,
    p.call_channel, p.agent_name, p.agent_phone,
    coalesce((select low from pct), 70),
    coalesce((select high from pct), 75),
    c.updated_at, c.channel, c.summary,
    p.brief, p.pinned_note
  from brrr_properties p
  left join lateral (
    select updated_at, channel, summary
    from brrr_property_calls
    where property_id = p.id
    order by updated_at desc
    limit 1
  ) c on true
  -- SECURITY DEFINER bypasses RLS, so THIS PREDICATE is the staff gate.
  where public.wk_is_agent_or_admin()
    and length((select t from tail)) >= 9
    and right(regexp_replace(coalesce(p.agent_phone, ''), '[^0-9]', '', 'g'), 9) = (select t from tail)
  order by coalesce(
    (p.deal -> 'offer' ->> 'max')::numeric,
    (p.deal ->> 'offer_max')::numeric
  ) desc nulls last, p.created_at desc;
$$;

revoke all on function public.wk_property_agent_listings(text) from public, anon;
grant execute on function public.wk_property_agent_listings(text) to authenticated;

comment on function public.wk_property_agent_listings(text) is
  'Staff-gated: every property this estate agency branch has listed, best offer first, with the deal jsonb, the live offer percentages, the next-step brief and Hugo''s pinned note. Read by usePropertyListings() for the dialer Houses panel.';
