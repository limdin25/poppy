-- The seven comparable rules, answered per lead, on the raw tab.
--
-- Hugo, 2026-08-19, after the Fontaine comparables audit, pasting the course's
-- own checklist back: "build it but make sure ai does all this as well before
-- send to my raw list ... make sure all of this is rock solid".
--
-- The rules, in his order:
--   1 postcode, then the same street, then the quarter mile
--   2 six months ideal, one year the rule, two years dead
--   3 photographs on every comparable, or it is not a comparable
--   4 condition judged from those photographs; a done-up value uses only
--     comps in the standard we will refurb to
--   5 the square metres of every comparable, and of the subject
--   6 the street, not the radius
--   7 what is ON the market as well as what sold
--
-- comp_checks holds one row per rule, exactly as the engine answered it:
--   [{"rule": "photographs", "ok": true,
--     "detail": "6 properties on the market within 402m, every one with
--                photographs and a floor area"}]
--
-- Nothing is computed here or in the browser. The engine (comp_gate.py) is the
-- only thing that decides, the assign script refuses to file a lead that did
-- not pass all seven, and this column is the receipt. A lead written before
-- this existed has an empty array, which the tab shows as "not checked"
-- rather than as seven quiet ticks nobody earned.

alter table wk_raw_leads add column if not exists comp_checks jsonb not null default '[]'::jsonb;

-- How many finished properties were ON the market within the quarter mile, and
-- what they were asking per square metre applied to this house. The ceiling is
-- only ever used to pull a done-up figure DOWN: an asking price is a hope, so
-- it can prove we are dreaming and it can never prove we are being modest.
alter table wk_raw_leads add column if not exists market_comps int;
alter table wk_raw_leads add column if not exists market_ceiling numeric;
