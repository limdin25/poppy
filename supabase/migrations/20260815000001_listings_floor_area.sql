-- The house-aware checklist needs to know what the machine already knows.
--
-- Hugo, 2026-08-15, on call length (yesterday's average doubled to ~4 minutes,
-- the Ripponden call ran 10): "are we asking information that does not
-- matter?" The fix: the Houses card only asks what the machine could NOT read
-- for that house. The floor area is the clearest case, resolved overnight from
-- the advert text, the EPC or the floor plan on most houses, and the dialer's
-- RPC simply did not project it, so the card could not know it was known.
--
-- DROP first: adding a column to `returns table` changes the row type, and
-- Postgres refuses to replace a function whose OUT parameters changed. The
-- revoke at the bottom is load-bearing: SECURITY DEFINER, and a fresh function
-- is EXECUTE to public until told otherwise.

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
  pinned_note        text,
  floor_area_sqm     numeric
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
    p.brief, p.pinned_note,
    p.floor_area_sqm
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
  'Staff-gated: every property this estate agency branch has listed, best offer first, with the deal jsonb, the live offer percentages, the next-step brief, Hugo''s pinned note and the resolved floor area. Read by usePropertyListings() for the dialer Houses panel.';
