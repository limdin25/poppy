-- The calibration set: what the engine said, beside what the branch said.
--
-- Hugo, 2026-08-11, asked how confident the pricing really is. The honest
-- answer was that no valuation had ever been checked against reality, and that
-- the check was already arriving on the phone every day and being discarded:
-- Pedro types the figure a branch names into the call card, it is filed as
-- free text on the property, and the property is then re-judged nightly and
-- overwritten. So the one piece of ground truth the business generates was
-- being thrown away daily.
--
-- This table is that ground truth, kept immutably. One row per call where a
-- branch named a figure, carrying BOTH sides of the comparison FROZEN at the
-- moment of the call:
--   what they said (raw text, and the number parsed out of it)
--   what we said   (asking, our value, our confidence, our offer band)
--
-- The engine's numbers are copied in rather than joined, on purpose. A deal is
-- re-priced every night, so a join would silently compare today's call against
-- next week's valuation and the calibration would drift without anyone
-- touching it. Same reasoning as the immutable agreement snapshots in
-- wk_agreement_signatures.
--
-- Service-role only, like brrr_properties itself: RLS on with NO policies, so
-- nothing reaches it with an anon key. Reads happen through the admin API
-- route, which is already staff-gated.

create table if not exists public.brrr_price_feedback (
  id              uuid primary key default gen_random_uuid(),
  property_id     uuid references public.brrr_properties(id) on delete set null,
  wk_call_id      uuid,
  agent_id        uuid,
  -- what they said
  said_text       text not null,
  said_price      numeric,
  said_parse_note text,
  -- what we said, at that moment
  asking_price    numeric,
  cmv             numeric,
  cmv_confidence  text,
  gdv             numeric,
  offer_open      numeric,
  offer_max       numeric,
  outcome         text,
  address         text,
  created_at      timestamptz not null default now()
);

comment on table public.brrr_price_feedback is
  'Immutable calibration set for the valuation engine: one row per call where an estate agent named a figure, holding what they said beside what the engine said at that moment. The engine figures are COPIED, never joined, because deals are re-priced nightly and a join would quietly compare a June call to an August valuation. Read by the admin Properties page and the overnight report.';

create index if not exists brrr_price_feedback_created_idx
  on public.brrr_price_feedback (created_at desc);
create index if not exists brrr_price_feedback_property_idx
  on public.brrr_price_feedback (property_id);

alter table public.brrr_price_feedback enable row level security;
-- Deliberately NO policies: service-role only, same posture as brrr_properties.
