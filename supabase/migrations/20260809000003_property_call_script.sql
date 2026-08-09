-- Third sales script: the property call.
--
-- Read by the dialer's middle column when it is opened for the Houses campaign
-- (?script=property_call). Pedro is ringing an estate agency to ask about a
-- house and float an offer. Nothing about the plumber cold-call script or the
-- VSL close script fits that conversation.
--
-- Its OWN table, for the same structural reason wk_vsl_close_script has one:
-- wk_sales_script is a hard singleton (id int PRIMARY KEY CHECK (id = 1)), so a
-- second script there means dropping a constraint every existing reader relies
-- on. Separate tables make it impossible for editing one script to touch
-- another — and Pedro and Marr read the cold-call script on every plumber dial,
-- so an accident there breaks their whole day silently.
--
-- Same shape, same trigger, same RLS as the other two: read = agents+admins,
-- write = admins.

CREATE TABLE IF NOT EXISTS wk_property_call_script (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  html        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- Seed the singleton so an UPDATE always has a row to hit (html NULL = use the
-- bundled default until an admin saves an edit).
INSERT INTO wk_property_call_script (id, html) VALUES (1, NULL)
  ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS wk_property_call_script_set_updated_at ON wk_property_call_script;
CREATE TRIGGER wk_property_call_script_set_updated_at
  BEFORE UPDATE ON wk_property_call_script
  FOR EACH ROW EXECUTE FUNCTION wk_set_updated_at();

ALTER TABLE wk_property_call_script ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wk_property_call_script_read ON wk_property_call_script;
CREATE POLICY wk_property_call_script_read ON wk_property_call_script
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());

DROP POLICY IF EXISTS wk_property_call_script_admin_all ON wk_property_call_script;
CREATE POLICY wk_property_call_script_admin_all ON wk_property_call_script
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());
