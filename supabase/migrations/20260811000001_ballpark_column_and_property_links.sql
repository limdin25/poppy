-- Two things Hugo asked for on 2026-08-11, both about not losing a live deal.
--
-- 1. A "Ballpark" column on the CRM board, right after Interested.
--
--    Hugo: "we need a new pipeline where it says ballpark achieved, where the
--    calls that we got the ballpark it goes there, you can make next to the
--    interested."
--
--    WHY IT IS NOT THE SAME AS "Awaiting director". There are two boards in
--    this product and they are not the same table. api/lib/brrr.ts files a
--    qualified property into `pipeline_stages` (business-scoped, the BRRR
--    board at /leads) and puts a figure under "Awaiting director". The board
--    Hugo actually watches all day is the CRM one, `wk_pipeline_columns`, and
--    nothing has ever moved a branch card on it when a figure came out of a
--    call. Dixons proved the cost: a branch agreed GBP 95,000 on the phone at
--    12:22, sat in Interested next to sixty other branches, and the callback
--    Pedro promised inside ten minutes never happened.
--
--    requires_followup is TRUE on purpose. That is the whole point of the
--    column: a ballpark is a promise to ring back, so the board should nag.
--
--    The colour matches the "Figure obtained" button on the dialer's Houses
--    tab (#B8860B, PropertiesPane.tsx), so the two surfaces read as one thing.
--
-- 2. wk_property_links(), so every surface can link out to the actual house.
--
--    Hugo: "if you want a link and go to rightmove from the pipeline or also
--    from the call recording we should be able to go and see the property. I
--    have no link to go see the property on rightmove."
--
--    The link already existed in brrr_properties.listing_url and was shown in
--    three places (the dialer Houses tab, the admin Properties page, the call
--    monitor). It was missing from the two surfaces Hugo lives in.
--
--    A BATCHED function rather than reusing wk_property_agent_listings(text):
--    that one takes a single phone and returns the whole deal jsonb, which is
--    right for the Houses tab and wrong for a board of a hundred cards. This
--    returns the few columns a link needs, for many phones, in one round trip.
--
--    Keyed on the LAST 9 DIGITS of the branch phone, exactly like its sibling,
--    because the scraper stores "0121 387 6499" and the ingest route stores
--    "+441213876499" and they are the same branch. One agency lists many
--    houses, so a phone can return several rows and the caller renders a count.

-- ── 1. The Ballpark column ────────────────────────────────────────────────

do $$
declare
  v_pipeline uuid;
  v_pos      int;
begin
  -- Only the board that actually has an Interested column. The HeyPubli
  -- Creators pipeline (New lead / Messaged / ...) must not be touched.
  for v_pipeline, v_pos in
    select pipeline_id, position
    from wk_pipeline_columns
    where name = 'Interested'
      and pipeline_id in (select pipeline_id from wk_pipeline_columns where name = 'Voicemail')
  loop
    -- Idempotent: a second run of this migration adds nothing.
    if exists (
      select 1 from wk_pipeline_columns
      where pipeline_id = v_pipeline and name = 'Ballpark'
    ) then
      continue;
    end if;

    -- Make room. Everything from Voicemail rightwards shifts one place,
    -- archived video-funnel columns included, so their order is preserved.
    --
    -- In two hops, via +1000, because (pipeline_id, position) is UNIQUE and
    -- NOT deferrable: a straight "position = position + 1" is checked row by
    -- row, so the first row bumped from 2 to 3 collides with the row still
    -- sitting at 3. Parking them out of range first is the only safe order.
    update wk_pipeline_columns
       set position   = position + 1000,
           sort_order = sort_order + 1000
     where pipeline_id = v_pipeline
       and position > v_pos;

    insert into wk_pipeline_columns
      (pipeline_id, name, colour, position, sort_order, requires_followup, is_terminal, archived)
    values
      (v_pipeline, 'Ballpark', '#B8860B', v_pos + 1, v_pos + 1, true, false, false);

    update wk_pipeline_columns
       set position   = position - 999,
           sort_order = sort_order - 999
     where pipeline_id = v_pipeline
       and position > 1000;
  end loop;
end $$;

comment on table wk_pipeline_columns is
  'CRM board columns, which double as the dialer outcome buttons. "Ballpark" (added 2026-08-11) is where a branch goes the moment it names or agrees a figure on the phone: it requires a follow-up because a ballpark is a promise to ring back.';

-- ── 2. Batched property links ─────────────────────────────────────────────

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
    and right(regexp_replace(coalesce(p.agent_phone, ''), '[^0-9]', '', 'g'), 9)
        in (select t from wanted)
  order by 1, p.created_at desc;
$$;

revoke all on function public.wk_property_links(text[]) from public, anon;
grant execute on function public.wk_property_links(text[]) to authenticated;

comment on function public.wk_property_links(text[]) is
  'Staff-gated. Given many branch phone numbers, returns the houses each one has listed with a clickable Rightmove URL. Batched on purpose: the CRM board and Call history render a hundred rows at a time and must not make a hundred round trips. Matched on the last 9 digits so "0121 387 6499" and "+441213876499" agree.';
