-- The board card says what to do next, and Nurturing sits where it is worked.
--
-- Hugo, 2026-08-14, looking at the two live deals on the pipeline: "when I click
-- on the deal it doesn't say what's all this information, the next steps that we
-- should email the customer etc, and also on the card on the pipeline it should
-- be already written there ... I think you should both stay under nurturing and
-- in nurturing you have to move to the left next to the discovery."
--
-- Two changes, and neither of them invents a fact:
--
--   1. wk_property_links() projects the brief, Hugo's pinned note, the branch
--      name and the person we spoke to. All four already exist on the row (see
--      20260814000001); the board simply could not see them, so a card that had
--      a whole paragraph of instruction on it rendered a phone number.
--   2. Nurturing moves from the far right of the board to the seat straight
--      after "Discovery done, evaluating". Nurturing is now what Hugo says it
--      is: a live deal that is waiting on one thing from Pedro (a confirmed
--      ballpark, an email address), not a dead lead parked at the end.
--
-- Re-run safe: both halves check the state they are moving to.

-- 1. THE BOARD'S BATCHED READ. Unchanged from 20260811000003 apart from the four
--    new output columns and the qualification join.
--
-- DROP first: adding a column to `returns table` changes the row type and
-- Postgres refuses to replace a function whose OUT parameters have changed. The
-- revoke at the bottom is load-bearing, a fresh SECURITY DEFINER function is
-- EXECUTE to public until told otherwise.
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
  branch_contact_name text
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
    nullif(btrim(coalesce(p.qualification ->> 'branch_contact_name', '')), '')
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
  'Staff-gated. Given many branch phone numbers, returns the LIVE houses each one has listed with a clickable Rightmove URL, the next-step brief, Hugo''s pinned note and the person we spoke to (deals withdrawn by the auditor are excluded; Call history shows those in the Full deal drawer instead). Batched on purpose: the CRM board and Call history render a hundred rows at a time and must not make a hundred round trips. Matched on the last 9 digits so "0121 387 6499" and "+441213876499" agree.';

-- 2. NURTURING MOVES LEFT, to the seat after Discovery.
--
-- (pipeline_id, position) is UNIQUE and not deferrable, so a straight
-- "position + 1" sweep can collide part way through its own statement. Every
-- column is pushed clear of the range first, then written back in the order we
-- want. One pipeline only, by name, so the HeyPubli board is untouched.
do $$
declare
  pid       uuid;
  nurt_id   uuid;
  nurt_pos  int;
  disc_pos  int;
begin
  select c.pipeline_id, c.id, c.position
    into pid, nurt_id, nurt_pos
  from wk_pipeline_columns c
  join wk_pipelines p on p.id = c.pipeline_id
  where c.name = 'Nurturing'
    and p.name = 'Default workspace pipeline'
  limit 1;

  if nurt_id is null then
    raise notice 'no Nurturing column on the default pipeline, nothing to move';
    return;
  end if;

  select position into disc_pos
  from wk_pipeline_columns
  where pipeline_id = pid and name = 'Discovery done, evaluating'
  limit 1;

  if disc_pos is null then
    raise notice 'no Discovery column to sit next to, leaving Nurturing where it is';
    return;
  end if;

  -- Already in its seat.
  if nurt_pos = disc_pos + 1 then
    return;
  end if;

  update wk_pipeline_columns
     set position = position + 1000
   where pipeline_id = pid;

  with ordered as (
    select
      id,
      row_number() over (
        order by case
          when id = nurt_id then (disc_pos::numeric) + 0.5
          else (position - 1000)::numeric
        end
      ) - 1 as newpos
    from wk_pipeline_columns
    where pipeline_id = pid
  )
  update wk_pipeline_columns c
     set position = o.newpos
    from ordered o
   where c.id = o.id;
end $$;
