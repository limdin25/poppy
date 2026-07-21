-- Editable sales script for the CRM dialer.
--
-- The dialer's middle column shows the one-call sales script (bundled HTML).
-- Admins can edit it in the browser and save so it sticks for the whole team;
-- agents read it. We persist only the rendered #page HTML (mainline + inline
-- objections). Singleton row (id = 1). Read = agents + admins, write = admins.

CREATE TABLE IF NOT EXISTS wk_sales_script (
  id          int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  html        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

-- Seed the singleton so an UPDATE always has a row to hit (html NULL = use the
-- bundled default until an admin saves an edit).
INSERT INTO wk_sales_script (id, html) VALUES (1, NULL)
  ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS wk_sales_script_set_updated_at ON wk_sales_script;
CREATE TRIGGER wk_sales_script_set_updated_at
  BEFORE UPDATE ON wk_sales_script
  FOR EACH ROW EXECUTE FUNCTION wk_set_updated_at();

ALTER TABLE wk_sales_script ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wk_sales_script_read ON wk_sales_script;
CREATE POLICY wk_sales_script_read ON wk_sales_script
  FOR SELECT TO authenticated USING (wk_is_agent_or_admin());

DROP POLICY IF EXISTS wk_sales_script_admin_all ON wk_sales_script;
CREATE POLICY wk_sales_script_admin_all ON wk_sales_script
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());
