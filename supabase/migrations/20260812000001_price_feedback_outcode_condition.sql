-- Two more things frozen beside every figure a branch names: WHERE the house
-- is, and WHAT CONDITION the engine thought it was in.
--
-- Stage 8 of the deal-engine build. brrr_price_feedback already holds what the
-- agent said against what the engine claimed, but a single median over the
-- whole country cannot tell you anything you can act on. Broken down by
-- outcode and by condition band it can: an area where branches consistently
-- talk above our valuation is a VALUATION problem in that area, and a
-- condition band where they consistently talk above our ceiling is a REFURB
-- problem in that band. Those are two different fixes on the scraper box.
--
-- Frozen at write time, for exactly the reason the rest of the row is frozen:
-- a property is re-priced every night and its condition read can change with
-- it, so a join would quietly compare a Tuesday call against Friday's survey
-- and the calibration would drift with nobody touching it.
--
-- Additive and nullable. Rows written before today keep NULL and the report
-- files them under "unknown" rather than inventing an area for them, except
-- for the outcode, which the report can still recover from the frozen address
-- because a postcode is not a thing that gets re-priced.

alter table public.brrr_price_feedback
  add column if not exists outcode        text,
  add column if not exists condition_band text;

comment on column public.brrr_price_feedback.outcode is
  'Postcode outward code (LE7, S8, NE31) read off the address at the moment of the call. Frozen, like every other engine figure on this row.';
comment on column public.brrr_price_feedback.condition_band is
  'What the property brain said the condition was when this call happened: derelict / full_refurb / modernisation / cosmetic / turnkey. NULL when it had not judged it, which is the normal state until the new engine ships.';

create index if not exists brrr_price_feedback_outcode_idx
  on public.brrr_price_feedback (outcode);
