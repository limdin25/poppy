-- Make the rewritten property call script the one Pedro actually reads.
--
-- 20260809000003 seeded wk_property_call_script with html = NULL, and NULL is
-- the "use the bundled default" signal: usePropertyCallScript returns null and
-- DialerScriptPane falls back to src/core/content/property-call-script.html.
-- So on a clean database, editing that file IS the deploy.
--
-- The row stops being NULL the first time an admin presses Save in the dialer.
-- After that the DB copy wins for ever and a repo edit is invisible on Pedro's
-- screen, which is exactly the trap this migration exists to avoid: the script
-- was rewritten on 2026-08-10 (identity answer, he negotiates himself, the
-- money ladder spelled out) and that rewrite has to reach the phone.
--
-- Verified on production before writing this: id 1, html IS NULL, so nothing
-- has been hand-edited yet and this discards no human work. It is written as an
-- explicit reset rather than left implicit so that re-running the migrations on
-- a database where somebody HAS saved an edit still lands the new words.
--
-- Touches this table and no other. The plumber cold-call script
-- (wk_sales_script) and the VSL close script (wk_vsl_close_script) are not
-- named here, on purpose: Pedro and Marr read the cold-call script on every
-- plumber dial and it must not move.

UPDATE wk_property_call_script
   SET html = NULL,
       updated_by = NULL
 WHERE id = 1;
