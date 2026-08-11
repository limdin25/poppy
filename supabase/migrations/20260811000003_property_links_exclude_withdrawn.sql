-- Keep withdrawn deals off the house chips.
--
-- 2026-08-11: a deal the auditor kills is no longer DELETED, it is filed with
-- status 'auditor_killed' so Call history can still show what a branch was
-- rung about (deleting them left Dixons with thirteen calls and nothing behind
-- them). But a chip is an invitation to look at live stock, so a withdrawn
-- house must not appear as one on the CRM board or the calls list. The record
-- lives one click deeper, in the Full deal drawer, where it is labelled.
--
-- Everything else is unchanged from 20260811000001.
-- Re-run safe.

create or replace function public.wk_property_links(p_phones text[])
returns table (
  phone_tail    text,
  property_id   uuid,
  listing_url   text,
  address       text,
  price_text    text,
  asking_price  numeric,
  bedrooms      int,
  property_type text
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
    p.asking_price, p.bedrooms, p.property_type
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
  'Staff-gated. Given many branch phone numbers, returns the LIVE houses each one has listed with a clickable Rightmove URL (deals withdrawn by the auditor are excluded; Call history shows those in the Full deal drawer instead). Batched on purpose: the CRM board and Call history render a hundred rows at a time and must not make a hundred round trips. Matched on the last 9 digits so "0121 387 6499" and "+441213876499" agree.';
