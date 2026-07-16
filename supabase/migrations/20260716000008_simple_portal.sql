-- Tradesperson client portal: a slim menu (Overview, Inbox, Appointments, Calls,
-- Quotes, Invoices, Settings) gated by the per-business `simple_portal` flag.
-- New sign-ups get the flag ON at registration; admins flip accounts to the
-- full app from Admin → Feature Flags.
INSERT INTO feature_flag_definitions (key, name, description, default_enabled)
VALUES (
  'simple_portal',
  'Client portal',
  'Slim tradesperson menu (Inbox, Appointments, Calls, Quotes, Invoices). Hides Leads, Campaigns, Knowledge Base, Templates, AI Agent, Integrations, Analytics.',
  false
)
ON CONFLICT (key) DO NOTHING;
