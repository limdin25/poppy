-- Fix a live silent failure, and open the door for the new funnel events.
--
-- Hugo 2026-07-26 asked where each funnel signal shows up. The audit found
-- `calc` (the value-calculator touch) was in api/vsl/track.ts BROWSER_TYPES and
-- fired by api/vsl/page.ts, but was never added to this CHECK. The insert at
-- track.ts did not inspect `error`, so Postgres rejected every one of them with
-- 23514 and nobody heard a thing.
--
-- Widened here for `calc` plus the two new types the tracking work adds:
--   link_click — the SMS link being tapped, logged server-side in page.ts
--   play       — the video actually being started
--
-- Shipped on its own, ahead of the RPC/columns work, because it is five lines
-- that fix something broken today and it must land BEFORE any new beacon type
-- or those inserts fail exactly as silently.
--
-- Re-run safe: drop-then-add the constraint by name. The original was an inline
-- column check, which Postgres auto-named wk_vsl_events_type_check.

alter table wk_vsl_events drop constraint if exists wk_vsl_events_type_check;

alter table wk_vsl_events add constraint wk_vsl_events_type_check check (type in (
  'open',           -- page rendered (JS beacon)
  'progress',       -- watch coverage crossed a marker; meta.pct
  'cta_click',      -- tapped "Start £1 Trial"
  'tier_pick',      -- chose a plan in the sheet
  'checkout_start', -- Stripe session created (server-owned)
  'paid',           -- Stripe webhook confirmed (server-owned)
  'auto_sms',       -- an automation nudge went out (api/cron/vsl-automation.ts)
  'link_click',     -- SMS link tapped (server-owned, api/vsl/page.ts)
  'play',           -- video started
  'calc'            -- value calculator touched
));
