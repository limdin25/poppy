-- Second sales script: the VSL follow-up close.
--
-- Read by the dialer's middle column when it is opened from the video funnel's
-- "Call to close" button (?script=vsl_close). A lead who has already watched the
-- video must not hear the cold-call opener, so this call needs its own words.
--
-- Its OWN table, not a second row in wk_sales_script: that table is a hard
-- singleton (id int PRIMARY KEY CHECK (id = 1)), so a second script there means
-- dropping the constraint every existing reader relies on. A separate table
-- makes it structurally impossible for editing one script to touch the other.
-- Same shape, same trigger, same RLS as wk_sales_script: read = agents+admins,
-- write = admins.

CREATE TABLE IF NOT EXISTS wk_vsl_close_script (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  html        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- Seed the singleton so an UPDATE always has a row to hit (html NULL = use the
-- bundled default until an admin saves an edit).
INSERT INTO wk_vsl_close_script (id, html) VALUES (1, NULL)
  ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS wk_vsl_close_script_set_updated_at ON wk_vsl_close_script;
CREATE TRIGGER wk_vsl_close_script_set_updated_at
  BEFORE UPDATE ON wk_vsl_close_script
  FOR EACH ROW EXECUTE FUNCTION wk_set_updated_at();

ALTER TABLE wk_vsl_close_script ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wk_vsl_close_script_read ON wk_vsl_close_script;
CREATE POLICY wk_vsl_close_script_read ON wk_vsl_close_script
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());

DROP POLICY IF EXISTS wk_vsl_close_script_admin_all ON wk_vsl_close_script;
CREATE POLICY wk_vsl_close_script_admin_all ON wk_vsl_close_script
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());
