-- The builder went, and sent photographs. The board could not see either.
--
-- Hugo, 2026-08-28, reading the board I had just shipped: "Lisle looks its
-- already done and builder send photo via whatsapp. Please see what you missed
-- and learn."
--
-- He was right, and it was not cosmetic. JL BRICKWORK walked 81 Lisle Road on
-- 26 August, and at 15:14 the next day sent TEN PHOTOGRAPHS on WhatsApp,
-- followed three minutes later by his written findings:
--
--   "The bathroom does not have a vent / extractor, boilers working fine and
--    last serviced 2025, Electric box need updating as not up to building regs
--    for a tenanted property, flat roof on extension looks fine"
--
-- That is the entire deliverable of the whole builder operation. The board had
-- him sitting in Coming, on a viewing two days in the past, and its lane header
-- said "JL BRICKWORK said yes but is not booked in", which is a lie about a man
-- who went and did the job.
--
-- WHAT I MISSED, so the next person does not. I read the message dump and my
-- eye slid over eleven rows with an EMPTY BODY. An empty body is not an empty
-- message: `media_urls` had one Twilio media URL on each of them. The text of a
-- conversation is not the conversation. Ten of the most valuable inbound
-- messages we have ever received looked like blank lines in a terminal.
--
-- THREE NEW FACTS, all DERIVED, none stored, for the same reason
-- address_sent_at is derived: a stored flag has to be set by every path and one
-- miss makes it lie for ever.
--
--   reported_at       he came back AFTER the viewing. Strong evidence he went.
--   media_count       how many pictures he actually sent.
--   media_message_ids so the drawer can draw them (InboundMedia wants the
--                     message id; the Twilio URL 401s without our credentials).
--
-- IT DOES NOT MOVE HIM TO Been BY ITSELF. Hugo's standing rule on the refurb
-- estimator is the same rule here: never invent, state the evidence, let the
-- person confirm. A message after a viewing is very good evidence that he
-- attended. It is not proof, and a board that quietly marks men as having
-- attended is a board nobody can trust about the ones who did not.

drop function if exists wk_builder_board(int);

create function wk_builder_board(p_days int default 21)
returns table (
  property_id      uuid,
  address          text,
  viewing_address  text,
  viewing_at       timestamptz,
  house_number_known boolean,
  assigned_builder_id uuid,
  outreach_id      uuid,
  builder_id       uuid,
  builder_name     text,
  builder_phone    text,
  contact_id       uuid,
  stage            text,
  status           text,
  channel          text,
  call_outcome     text,
  call_outcome_at  timestamptz,
  sent_at          timestamptz,
  replied_at       timestamptz,
  declined_at      timestamptz,
  agreed_at        timestamptz,
  come_back_at     timestamptz,
  come_back_note   text,
  attended_at      timestamptz,
  quote_amount     numeric,
  quote_note       text,
  charges_amount   numeric,
  address_sent_at  timestamptz,
  last_inbound_at  timestamptz,
  last_inbound_body text,
  last_outbound_at timestamptz,
  reported_at      timestamptz,
  media_count      int,
  media_message_ids uuid[],
  reviews_note     text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with house as (
    select p.id, p.address, p.viewing_address, p.viewing_at, p.assigned_builder_id,
           nullif(trim(split_part(p.viewing_address, ',', 1)), '') as num,
           nullif(trim(split_part(p.viewing_address, ',', 2)), '') as street
    from brrr_properties p
    where p.viewing_at is not null
      and p.viewing_at >= now() - make_interval(days => p_days)
  )
  select
    h.id,
    h.address,
    h.viewing_address,
    h.viewing_at,
    (h.num is not null and h.street is not null),
    h.assigned_builder_id,
    o.id,
    o.builder_id,
    b.name,
    b.phone,
    o.contact_id,
    o.stage,
    o.status,
    o.channel,
    o.call_outcome,
    o.call_outcome_at,
    o.sent_at,
    o.replied_at,
    o.declined_at,
    o.agreed_at,
    o.come_back_at,
    o.come_back_note,
    o.attended_at,
    o.quote_amount,
    o.quote_note,
    o.charges_amount,
    -- Has he been told WHICH DOOR? The house number followed by the street, in
    -- anything we actually sent him. Optional comma because the desk writes
    -- "81, Lisle Road" and a person types "81 Lisle Road".
    (select min(m.created_at) from wk_sms_messages m
      where m.contact_id = o.contact_id
        and m.direction = 'outbound'
        and coalesce(m.status, '') not in ('draft', 'discarded')
        and h.num is not null and h.street is not null
        and m.body ~* ('(^|[^0-9])' || h.num || ',?\s+' || h.street)),
    (select max(m.created_at) from wk_sms_messages m
      where m.contact_id = o.contact_id and m.direction = 'inbound'),
    -- An empty body with pictures on it is not an empty message. Saying so here
    -- rather than in the client keeps every reader of this RPC honest.
    (select case
       when coalesce(nullif(trim(m.body), ''), '') <> '' then m.body
       when cardinality(m.media_urls) = 1 then 'Sent a photo'
       when cardinality(m.media_urls) > 1 then 'Sent ' || cardinality(m.media_urls) || ' photos'
       else ''
     end
     from wk_sms_messages m
      where m.contact_id = o.contact_id and m.direction = 'inbound'
      order by m.created_at desc limit 1),
    -- So the board can say "he said something since you booked him and nobody
    -- has answered". M Riding texted "Hi I won't be able to make tomorrow" the
    -- evening before, and the house still read as covered.
    (select max(m.created_at) from wk_sms_messages m
      where m.contact_id = o.contact_id and m.direction = 'outbound'
        and coalesce(m.status, '') not in ('draft', 'discarded')),
    -- HE CAME BACK AFTER THE VIEWING. The one signal that separates a builder
    -- who did the job from a builder who said yes and vanished.
    (select min(m.created_at) from wk_sms_messages m
      where m.contact_id = o.contact_id and m.direction = 'inbound'
        and m.created_at > h.viewing_at),
    (select coalesce(sum(cardinality(m.media_urls)), 0)::int from wk_sms_messages m
      where m.contact_id = o.contact_id and m.direction = 'inbound'),
    (select coalesce(array_agg(m.id order by m.created_at), '{}') from wk_sms_messages m
      where m.contact_id = o.contact_id and m.direction = 'inbound'
        and cardinality(m.media_urls) > 0),
    b.notes
  from house h
  join brrr_builder_outreach o on o.property_id = h.id
  join brrr_builders b on b.id = o.builder_id
  order by h.viewing_at, b.name
$$;

comment on function wk_builder_board(int) is
  'One row per builder-per-house. address_sent_at, reported_at, media_count and media_message_ids are all derived from the real messages, never stored, so they cannot drift.';

revoke all on function wk_builder_board(int) from public;
grant execute on function wk_builder_board(int) to authenticated, service_role;

-- REVERT: re-run 20260828000001, which creates the previous shape.
