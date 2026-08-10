-- The property call script now leads with the ballpark, and never views a house.
--
-- Rewritten on the evening of 2026-08-10, after the first full day of real
-- calls was measured rather than guessed at:
--
--   * The money landed at a MEDIAN 87% of the way through the call, because it
--     sat behind a sixteen-question checklist. The two calls that reached the
--     figure early (45% and 52%) were the only two real negotiations of the
--     day. So three questions now stand between the opener and the money
--     (empty, needs work, why selling) and the rest of the checklist moved to
--     after it, to be filled in only when the money went somewhere.
--   * "You'll have to view it first" beat him four times out of four, because
--     the script promised a viewing ("Understood, and we would") and had no
--     concept of a builder. The answer is now that we put the figure forward
--     subject to our builder going round, who views it and prices the refurb in
--     one trip, plus an ask for a video walkthrough on every call.
--   * A branch named the vendor's figure once all day and the call was ended on
--     it with "thank you for your time". THEY NAME A FIGURE is now a panel of
--     its own and the single loudest thing on the page.
--
-- Objection panels went 30 -> 42, the new ones written from what real agents
-- actually said on those calls.
--
-- WHY THIS FILE EXISTS AT ALL. html IS NULL means "use the bundled default",
-- so src/core/content/property-call-script.html is what Pedro reads and a repo
-- edit IS the deploy. The row stops being NULL the first time an admin presses
-- Save in the dialer, and from then on the DB copy wins for ever and the repo
-- edit is invisible, on his screen AND in the daily report, which grades
-- against the same source. Verified on production immediately before writing
-- this: id 1, html IS NULL, updated_by NULL. So this discards no human work,
-- and it is written as an explicit reset so that re-running the migrations on a
-- database where somebody HAS saved an edit still lands the new words.
--
-- Touches this table and no other. The plumber cold-call script
-- (wk_sales_script) and the VSL close script (wk_vsl_close_script) are not
-- named here on purpose: Marr reads the cold-call script on every dial and it
-- must not move.

UPDATE wk_property_call_script
   SET html = NULL,
       updated_by = NULL
 WHERE id = 1;
