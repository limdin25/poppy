-- Call two now opens as the callback it is, never as a cold call.
--
-- Hugo, 2026-08-18, after watching Jones & Chapman (Ready for call 2, ballpark
-- confirmed at 153,000) open on "Hi, hello. I'm calling about the property on
-- Friars Close. Is that one still available?": "on call number two that we
-- make the call directly from the pipeline, it should not open the first
-- script, this is a callback. It should say we spoke the other day, dynamic
-- of the days that we spoke, and then make the ballpark offer."
--
-- Four root causes fixed in src/core/content/property-call-script.html and
-- the surrounding code, this same day:
--   1. Stages 1 and 2 (the cold opener and the Unico intro) sat OUTSIDE the
--      .call1 wrapper, so the offer view's ".call1{display:none}" never hid
--      them and every call two still opened cold. They are now inside it.
--   2. The call-two opener read "[their name]", which is not a token at all
--      (the space defeats the fill), so it rendered literally. It is now
--      [branch_contact_name], filled from the name Pedro wrote down on call
--      one, collapsing to "Hi," when no name is on file.
--   3. Nothing said WHEN we spoke. New token [spoke_when] ("earlier today",
--      "yesterday", "on Friday"), computed from wk_calls in the browser and
--      never persisted; collapses cleanly when there is no prior call.
--   4. The board column now arms the view (promote-only): a card in Ready
--      for call 2 or beyond opens on call two even if a no_answer knocked
--      the step tag back.
--
-- WHY THIS FILE EXISTS AT ALL. html IS NULL means "use the bundled default",
-- so the repo file is what Pedro reads and a repo edit IS the deploy. The row
-- stops being NULL the first time an admin presses Save in the dialer, and
-- from then on the DB copy wins for ever and the repo edit is invisible, on
-- his screen AND in the daily report, which grades against the same source.
-- Verified on production immediately before writing this (2026-08-18, psql):
-- id 1, html IS NULL, updated_by NULL, updated_at 2026-08-10. So this
-- discards no human work, and it is written as an explicit reset so that
-- re-running the migrations on a database where somebody HAS saved an edit
-- still lands the new words.
--
-- Touches this table and no other. The plumber cold-call script
-- (wk_sales_script) and the VSL close script (wk_vsl_close_script) are not
-- named here on purpose: Marr reads the cold-call script on every dial and it
-- must not move.

UPDATE wk_property_call_script
   SET html = NULL,
       updated_by = NULL
 WHERE id = 1;
