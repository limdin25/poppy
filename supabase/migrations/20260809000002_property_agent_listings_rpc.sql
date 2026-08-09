-- Everything an agent needs on screen while ringing one estate agency branch.
--
-- brrr_properties has NO RLS and is service-role only, by design
-- (20260610000001_brrr_properties.sql). Pedro dials from a browser holding an
-- anon-key session, so he cannot read that table at all — and turning RLS on
-- would change the security posture of the whole AI path to serve one screen.
--
-- Same answer the repo already uses for exactly this shape of problem:
-- a SECURITY DEFINER function with an explicit projection and a staff gate,
-- mirroring wk_agent_directory (20260727000007). SECURITY DEFINER bypasses RLS,
-- so THE PREDICATE IS THE GATE.
--
-- Keyed on the branch phone rather than a property id because one estate agency
-- lists many houses and Pedro rings the branch once, not once per house.
-- Matching is on the last 9 digits so "0191 625 0242" and "+441916250242" are
-- the same branch — see brrr_properties_agent_phone_tail_idx.
--
-- Deliberately NOT returned: the comps jsonb blob (big, and the pane fetches
-- what it needs from deal.evidence), agent_branch_url, and anything about other
-- branches. The two offer percentages ride along so the browser computes the
-- same band as the server instead of hardcoding 70/75 a fourth time.
--
-- Re-run safe.

create or replace function public.wk_property_agent_listings(p_phone text)
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
  last_call_summary  text
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
    c.updated_at, c.channel, c.summary
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
    -- A short or empty phone would tail-match half the table.
    and length((select t from tail)) >= 9
    and right(regexp_replace(coalesce(p.agent_phone, ''), '[^0-9]', '', 'g'), 9) = (select t from tail)
  -- Best deal first: it is the one the offer strip and the script open with.
  order by (p.deal ->> 'offer_max')::numeric desc nulls last, p.created_at desc;
$$;

revoke all on function public.wk_property_agent_listings(text) from public, anon;
grant execute on function public.wk_property_agent_listings(text) to authenticated;

comment on function public.wk_property_agent_listings(text) is
  'Staff-gated: every property this estate agency branch has listed, best offer first, with the deal jsonb and the live offer percentages. Read by usePropertyListings() for the dialer Houses tab. Matched on the last 9 digits of the phone so formatted and E.164 numbers agree.';
