-- "Needs viewing" becomes "Viewing booked" (Hugo, 2026-08-19: "instead of
-- needs viewing, viewing booked"). The column used to be a dead end: nothing
-- ever moved a card into it (the gap documented in deal-manager-contract.ts).
-- Now the builder-confirm press moves the card here, so the name says what is
-- true when a card arrives: a builder is booked onto the viewing.
--
-- Scoped to the property pipeline by the same lookup every reader uses: the
-- pipeline that owns the column named 'Ballpark agreed'. Code mirrors of the
-- stage list (PROPERTY_STAGES and friends) are updated in the same commit;
-- names are matched case-exact, so this migration and the code deploy travel
-- together.

update wk_pipeline_columns
set name = 'Viewing booked'
where name = 'Needs viewing'
  and pipeline_id in (
    select pipeline_id from wk_pipeline_columns where name = 'Ballpark agreed'
  );
