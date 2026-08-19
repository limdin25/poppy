-- The subject's own size joins the raw tab.
--
-- Hugo, 2026-08-19, seeing comps with sizes beside a house without one:
-- "if we don't know the size of our property, we cannot make comparisons,
-- so we cannot use it." The pool now refuses unsized subjects; these two
-- columns carry the size and where it came from (listing | floorplan |
-- text | description) so the spreadsheet can show the tick and the number.

alter table wk_raw_leads add column if not exists floor_area_sqm numeric;
alter table wk_raw_leads add column if not exists area_source text;
