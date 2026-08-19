-- The ballpark moves onto call one, behind one button.
--
-- Hugo, 2026-08-19 (voice): "from the call number one we need a button there
-- that Pedro presses, very clear button on the top, and then give us the
-- ballpark when Pedro is ready. Pedro says: okay, let me check my system
-- here, I'm not making an offer. I just want to know if I'm in the ballpark
-- or a million miles off."
--
-- The course itself teaches this exact move ("Offer Without Offering", Deal
-- Sourcing Course): desktop valuation first, then on the call: "if I was to
-- offer around this, would I be in the ballpark or would I be a million
-- miles off?" Agent says in range, THEN the builder goes round, THEN the
-- official offer. Our overnight machine is the desktop valuation, so the
-- two-call wait existed only because nothing could price the condition
-- mid-call. Now the room has a Get the ballpark button (BallparkOnCallPanel)
-- that listens to the live call and prices it in seconds.
--
-- What changed in src/core/content/property-call-script.html:
--   1. Stage 5 is now "Check the system, then lock the next step": press the
--      green button, say the checking-my-system line while it prices THIS
--      call, then read the panel's sentence word for word. One number, then
--      silence, no negotiating on call one. Three new objection panels: in
--      the ballpark, a million miles off, and "so is that an offer then?".
--   2. The intro's call-one law is rewritten: the only number of ours on
--      call one is the one the panel prices mid-call, never one from
--      Pedro's head. Call one still carries NO money tokens; the figure
--      exists only in the panel, which only answers after hearing the call.
--   3. The call-two note no longer claims the ballpark question lives only
--      on call two; call two keeps the ladder and the real negotiation.
--
-- WHY THIS FILE EXISTS AT ALL. html IS NULL means "use the bundled default",
-- so the repo file is what Pedro reads and a repo edit IS the deploy.
-- Verified on production immediately before writing this (2026-08-19, psql):
-- id 1, html IS NULL. So this discards no human work, and it is written as
-- an explicit reset so that re-running the migrations on a database where
-- somebody HAS saved an edit still lands the new stage.
--
-- Touches this table and no other. The plumber cold-call script
-- (wk_sales_script) and the VSL close script (wk_vsl_close_script) are not
-- named here on purpose: Marr reads the cold-call script on every dial and it
-- must not move.

UPDATE wk_property_call_script
   SET html = NULL,
       updated_by = NULL
 WHERE id = 1;
