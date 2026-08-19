-- The card says the deal before anybody opens anything.
--
-- Hugo, 19 Aug, on the board: "I want to show asking price, I wanna see right
-- away if there's a mistake before I open anything. Asking price and then
-- brackets percent below market, and then ballpark, and comparison strong,
-- and the confidence, and refurbishment and why."
--
-- wk_property_links gains ONE jsonb column, `facts`, built from the deal blob
-- (or, when the deal is empty because the branch is still in discovery, from
-- the ballpark homework). Every figure is READ, never derived: worth is the
-- engine's, the band is the engine's, the why is the engine's sentence. The
-- one derived value, percent below market, is arithmetic on two read numbers
-- and is computed in the component so a display rule never lives in SQL.
--
-- DROP first: adding a column to `returns table` changes the row type and
-- Postgres refuses to replace a function whose OUT parameters have changed.
-- The revoke at the bottom is load-bearing, a fresh SECURITY DEFINER function
-- is EXECUTE to public until told otherwise.

drop function if exists public.wk_property_links(text[]);

create function public.wk_property_links(p_phones text[])
returns table (
  phone_tail          text,
  property_id         uuid,
  listing_url         text,
  address             text,
  price_text          text,
  asking_price        numeric,
  bedrooms            int,
  property_type       text,
  brief               jsonb,
  pinned_note         text,
  agent_name          text,
  branch_contact_name text,
  facts               jsonb
)
language sql stable security definer set search_path = public as $$
  with wanted as (
    select distinct right(regexp_replace(coalesce(x, ''), '[^0-9]', '', 'g'), 9) as t
    from unnest(coalesce(p_phones, '{}'::text[])) as x
    -- A short or empty phone would tail-match half the table.
    where length(regexp_replace(coalesce(x, ''), '[^0-9]', '', 'g')) >= 9
  )
  select
    right(regexp_replace(coalesce(p.agent_phone, ''), '[^0-9]', '', 'g'), 9),
    p.id, p.listing_url, p.address, p.price_text,
    p.asking_price, p.bedrooms, p.property_type,
    p.brief, p.pinned_note, p.agent_name,
    nullif(btrim(coalesce(p.qualification ->> 'branch_contact_name', '')), ''),
    -- The deal in six facts. The armed deal wins; the ballpark homework
    -- stands in when the deal is empty (discovery lane); absent keys stay
    -- null and the component says nothing rather than guessing.
    jsonb_strip_nulls(jsonb_build_object(
      'worth',      coalesce((p.deal -> 'cmv' ->> 'estimate')::numeric,
                             (p.ballpark_preview -> 'engine' ->> 'tmv')::numeric),
      'confidence', coalesce(p.deal -> 'cmv' ->> 'confidence',
                             p.deal ->> 'cmv_confidence'),
      'open',       coalesce((p.deal -> 'offer' ->> 'open')::numeric,
                             (p.ballpark_preview -> 'engine' ->> 'open')::numeric),
      'ceiling',    coalesce((p.deal -> 'offer' ->> 'max')::numeric,
                             (p.deal -> 'offer' ->> 'ceiling')::numeric,
                             (p.ballpark_preview -> 'engine' ->> 'ceiling')::numeric),
      'tier',       coalesce(p.deal ->> 'comps_tier',
                             p.ballpark_preview -> 'engine' ->> 'comps_tier'),
      'refurb',     coalesce((p.deal -> 'refurb' ->> 'low')::numeric,
                             (p.ballpark_preview -> 'engine' ->> 'refurb')::numeric),
      'condition',  coalesce(p.deal ->> 'condition_band',
                             p.deal -> 'refurb' ->> 'band',
                             p.ballpark_preview -> 'engine' ->> 'refurb_band'),
      'why',        coalesce(p.deal ->> 'why',
                             p.ballpark_preview -> 'engine' ->> 'why'),
      -- Which mouth the figures came from, so the card can say "homework,
      -- not yet armed" when the deal is empty.
      'source',     case when p.deal -> 'offer' ->> 'open' is not null then 'deal'
                         when p.ballpark_preview -> 'engine' ->> 'open' is not null then 'ballpark'
                         else null end
    ))
  from brrr_properties p
  -- SECURITY DEFINER bypasses RLS (brrr_properties has none and is service-role
  -- only by design), so THIS PREDICATE is the staff gate.
  where public.wk_is_agent_or_admin()
    and p.listing_url is not null
    and p.listing_url <> ''
    and coalesce(p.status, '') <> 'auditor_killed'
    and right(regexp_replace(coalesce(p.agent_phone, ''), '[^0-9]', '', 'g'), 9)
        in (select t from wanted)
  order by 1, p.created_at desc;
$$;

revoke all on function public.wk_property_links(text[]) from public, anon;
grant execute on function public.wk_property_links(text[]) to authenticated;

comment on function public.wk_property_links(text[]) is
  'Staff-gated. Given many branch phone numbers, returns the LIVE houses each one has listed with a clickable Rightmove URL, the next-step brief, Hugo''s pinned note, the person we spoke to, and `facts` (worth, band, comps tier, confidence, refurb, why; from the armed deal or, in discovery, the ballpark homework). Batched on purpose: the CRM board and Call history render a hundred rows at a time and must not make a hundred round trips. Matched on the last 9 digits so "0121 387 6499" and "+441213876499" agree.';
