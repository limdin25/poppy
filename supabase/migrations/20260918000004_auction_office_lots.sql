-- What the Auction call room shows: every lot we hold for one auction office.
--
-- One office phone is one contact (Hugo, 2026-09-18: one call covers every lot
-- of theirs on our list), so the room loads the office's lots by the last nine
-- digits of its phone, the same match every property screen uses.
--
-- Its own function rather than more columns on wk_property_agent_listings,
-- which the Houses room reads on every estate-agent dial. That one is also
-- fenced to the Houses desk here, so an auction lot can never appear in an
-- estate agent's Houses tab even if two numbers ever collide.

create or replace function public.wk_property_agent_listings(p_phone text)
 returns table(id uuid, source_property_id text, listing_url text, address text, price_text text, asking_price numeric, bedrooms integer, property_type text, days_on_market text, floorplan_urls jsonb, deal jsonb, status text, qualification jsonb, notes text, call_channel text, agent_name text, agent_phone text, offer_low_pct numeric, offer_high_pct numeric, last_call_at timestamp with time zone, last_call_channel text, last_call_summary text, brief jsonb, pinned_note text, floor_area_sqm numeric, ballpark_preview jsonb)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
    p.floor_area_sqm,
    p.ballpark_preview
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
    and p.desk = 'houses'
    and length((select t from tail)) >= 9
    and right(regexp_replace(coalesce(p.agent_phone, ''), '[^0-9]', '', 'g'), 9) = (select t from tail)
  order by coalesce(
    (p.deal -> 'offer' ->> 'max')::numeric,
    (p.deal ->> 'offer_max')::numeric
  ) desc nulls last, p.created_at desc;
$function$;

create or replace function public.wk_auction_office_lots(p_phone text)
returns table (
  id                 uuid,
  source             text,
  source_property_id text,
  listing_url        text,
  address            text,
  price_text         text,
  asking_price       numeric,
  bedrooms           integer,
  property_type      text,
  floor_area_sqm     numeric,
  floorplan_urls     jsonb,
  photo_urls         text[],
  auction            jsonb,
  deal               jsonb,
  comps              jsonb,
  status             text,
  qualification      jsonb,
  notes              text,
  agent_name         text,
  agent_phone        text,
  brief              jsonb,
  last_call_at       timestamptz,
  last_call_summary  text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with tail as (
    select right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9) as t
  )
  select
    p.id, p.source, p.source_property_id, p.listing_url, p.address,
    p.price_text, p.asking_price, p.bedrooms, p.property_type,
    p.floor_area_sqm, p.floorplan_urls, p.photo_urls, p.auction, p.deal,
    p.comps, p.status, p.qualification, p.notes, p.agent_name, p.agent_phone,
    p.brief, c.updated_at, c.summary
  from brrr_properties p
  left join lateral (
    select updated_at, summary
    from brrr_property_calls
    where property_id = p.id
    order by updated_at desc
    limit 1
  ) c on true
  -- SECURITY DEFINER bypasses RLS, so THIS PREDICATE is the staff gate.
  where public.wk_is_agent_or_admin()
    and p.desk = 'auction'
    and length((select t from tail)) >= 9
    and right(regexp_replace(coalesce(p.agent_phone, ''), '[^0-9]', '', 'g'), 9) = (select t from tail)
  -- Live lots first, the biggest discount on strong evidence first.
  order by (p.status in ('auditor_killed', 'sold', 'not_suitable')) asc,
           coalesce((p.deal ->> 'local_discount_pct')::numeric, 0) desc,
           p.created_at desc;
$$;

revoke all on function public.wk_auction_office_lots(text) from public, anon;
grant execute on function public.wk_auction_office_lots(text) to authenticated, service_role;
