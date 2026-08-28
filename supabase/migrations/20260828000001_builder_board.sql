-- The builder board: which builder is going to which house, and who is not.
--
-- Hugo, 2026-08-28, relaying Pedro: "a pipeline the same as we have for the
-- properties but now for the builders, so he can have better control, how he
-- can coordinate which builder has been booked for what property, maybe on the
-- same place where he calls the builder, a kanban view there."
--
-- WHAT THE FIRST WEEK OF REAL BOOKINGS SHOWED, measured before writing a line.
-- Six viewings happened on 26 and 27 August. A builder turned up at THREE.
-- The three that failed were not bad luck:
--
--   * Windsor Road, Buxton. CJS Builders: "Morning. I'm happy to do this for
--     you. What number am I meeting you at?" Nobody sent it. On the day:
--     "Hi. Assume today's meet isn't on? No address."
--   * Oxford Gardens, Stafford. PZ Builders confirmed the slot and asked for
--     the address three times. Staffs Lofts: "What number Oxford gardens is it
--     and I will book it in the diary." Neither was ever told. On the morning:
--     "Is this afternoon's meeting still going ahead? If so will require the
--     address please."
--   * Lunar Builders, a week earlier: "I won't be able to make it today as I
--     needed the full address in advance and didn't receive it in time."
--
-- Those two houses are EXACTLY the two with no viewing_address on file. Every
-- house that had a house number got a builder through the door. So the single
-- most valuable thing this board can show is not a stage at all: it is whether
-- the man who said yes has actually been told which door to knock on.
--
-- WHY address_sent_at IS DERIVED AND NEVER STORED. It is the same argument as
-- wk_threads_awaiting_reply: a stored flag has to be set by every send path
-- (the desk, the dialog, the cockpit panel, a hand-typed reply in the inbox)
-- and one miss makes it lie for ever, on the one fact that decides whether the
-- viewing happens. Read-time matching against the real outbound messages cannot
-- drift. Verified on the live data the day this shipped: it returns a stamp for
-- exactly JL Brickwork, Everyday Home Improvements and Sycamore Carpentry, the
-- three builders who attended, and null for all 28 others.
--
-- WHY stage IS STORED WHEN status ALREADY EXISTS. They answer different
-- questions and both are needed. `status` is what the WIRE did (we sent it, it
-- was delivered, he replied). `stage` is Pedro's own judgement about where the
-- man is, which is the thing a board has to let him drag. Deriving the column
-- from status would make the board read-only, and status cannot express the
-- distinction that matters most: 47 of the 80 rows still at 'draft' have a call
-- outcome on them, because Pedro rings builders he has never texted.

-- ---------------------------------------------------------------------------
-- 1. The columns the board owns.
-- ---------------------------------------------------------------------------
alter table brrr_builder_outreach
  -- Pedro's board position. Seeded from the evidence below, his to move after.
  add column if not exists stage          text not null default 'to_do',
  add column if not exists stage_moved_at timestamptz,
  add column if not exists stage_moved_by uuid references profiles(id),
  -- The time THIS builder agreed to, when it is not the property's viewing_at.
  -- Fox Built: "I'm not available this Friday, I can do Wednesday 2nd September
  -- at 5pm." That date existed nowhere, so the board showed him as coming to a
  -- viewing he had already turned down.
  add column if not exists agreed_at      timestamptz,
  -- The diary. "Ring him back on the 31st." Every one of these was said out
  -- loud and then lost: Gulliver Builders ("away until Monday 31st August, I
  -- can have a look once I'm back"), Gud Builders ("busy till October"), Mark
  -- James ("I'm back on the 2nd, so it'll be about the 4th I can come and have
  -- a look"), Ground Up ("can you do an evening next week?"). Pedro answered
  -- every one of them with "I'll check with the team and come back to you" and
  -- there was nowhere to put it.
  add column if not exists come_back_at   timestamptz,
  add column if not exists come_back_note text,
  -- He turned up. Nothing in the app could say this, so a builder who walked
  -- the house looked identical to one who ignored us.
  add column if not exists attended_at    timestamptz,
  -- What he came back with. brrr_properties.viewing_quote holds one number for
  -- the house; this is per builder, because the point of inviting several is to
  -- compare them.
  add column if not exists quote_amount   numeric(12,2),
  add column if not exists quote_note     text,
  add column if not exists quote_at       timestamptz,
  -- Some of them charge to attend. Phil Oakley Contractors: "it's a cost of
  -- £120 including VAT, and if you go ahead with the work you get the £120 off
  -- the quote." CM Building: "This is more like a Builders survey, which is
  -- chargeable. Our rates for a full Builder survey is £595 + VAT."
  add column if not exists charges_amount numeric(12,2);

do $$ begin
  alter table brrr_builder_outreach add constraint brrr_builder_outreach_stage_check
    check (stage in ('to_do','chasing','talking','coming','booked','been','no'));
exception when duplicate_object then null; end $$;

comment on column brrr_builder_outreach.stage is
  'Pedro''s board position, his to drag. NOT a copy of status: status is what the wire did, stage is where the man is.';
comment on column brrr_builder_outreach.agreed_at is
  'The slot THIS builder agreed to, when it differs from the property viewing_at.';
comment on column brrr_builder_outreach.come_back_at is
  'Ring him back on this date. For the ones who said "not this week, try me later".';

create index if not exists brrr_builder_outreach_stage_idx
  on brrr_builder_outreach (property_id, stage);
create index if not exists brrr_builder_outreach_comeback_idx
  on brrr_builder_outreach (come_back_at)
  where come_back_at is not null;

-- ---------------------------------------------------------------------------
-- 2. Seed the board from what already happened.
-- ---------------------------------------------------------------------------
-- Ordered most specific first. Runs once: every existing row is at the default
-- 'to_do' and nothing else writes stage yet.
update brrr_builder_outreach o set stage = case
  when exists (select 1 from brrr_properties p
                where p.id = o.property_id and p.assigned_builder_id = o.builder_id) then 'booked'
  when o.status = 'confirmed'                                     then 'booked'
  when o.status = 'declined'                                      then 'no'
  when o.call_outcome in ('not_interested','wrong_number')        then 'no'
  when o.status = 'skipped'                                       then 'no'
  when o.call_outcome = 'coming'                                  then 'coming'
  when o.call_outcome in ('wants_details','call_back')            then 'talking'
  when o.replied_at is not null                                   then 'talking'
  when o.call_outcome = 'no_answer'                               then 'chasing'
  when o.status = 'sent'                                          then 'chasing'
  else 'to_do'
end
where o.stage = 'to_do';

-- ---------------------------------------------------------------------------
-- 3. The board, in one call.
-- ---------------------------------------------------------------------------
-- One row per builder-per-house, which is the actual unit of work: not a
-- builder (228 of them, no context) and not a house (that is the property
-- pipeline). "Jerry for Whitworth Road" is the card.
--
-- SECURITY DEFINER for the same reason as wk_threads_awaiting_reply: the
-- builder tables carry no RLS and are service-role only, and this is read-only.
-- The gate is the route (wk_is_agent_or_admin), exactly as the Find Builders
-- desk already does it.
-- Dropped rather than replaced: create-or-replace cannot change a returns-table
-- signature, so a later column added here would fail on every environment that
-- already had the old shape.
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
    (select m.body from wk_sms_messages m
      where m.contact_id = o.contact_id and m.direction = 'inbound'
      order by m.created_at desc limit 1),
    -- So the board can say "he has said something since you booked him and
    -- nobody has answered". M Riding builders was assigned to Stevenson Avenue
    -- and texted "Hi I won't be able to make tomorrow" the evening before. His
    -- status stayed 'confirmed' and the house still read as covered, which is
    -- the most dangerous state the old screen could be in: a false green.
    (select max(m.created_at) from wk_sms_messages m
      where m.contact_id = o.contact_id and m.direction = 'outbound'
        and coalesce(m.status, '') not in ('draft', 'discarded')),
    b.notes
  from house h
  join brrr_builder_outreach o on o.property_id = h.id
  join brrr_builders b on b.id = o.builder_id
  order by h.viewing_at, b.name
$$;

comment on function wk_builder_board(int) is
  'One row per builder-per-house for houses with a viewing in the window. address_sent_at is derived from the real outbound messages, never stored, so it cannot drift.';

revoke all on function wk_builder_board(int) from public;
grant execute on function wk_builder_board(int) to authenticated, service_role;

-- REVERT (run by hand):
--   drop function if exists wk_builder_board(int);
--   alter table brrr_builder_outreach
--     drop column if exists stage, drop column if exists stage_moved_at,
--     drop column if exists stage_moved_by, drop column if exists agreed_at,
--     drop column if exists come_back_at, drop column if exists come_back_note,
--     drop column if exists attended_at, drop column if exists quote_amount,
--     drop column if exists quote_note, drop column if exists quote_at,
--     drop column if exists charges_amount;
