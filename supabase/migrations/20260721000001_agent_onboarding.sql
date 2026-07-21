-- Agent onboarding — hire & onboard CRM agents via a signable agreement.
--
-- Flow: admin shares a public link → new hire reads + signs the agreement
-- (name + drawn signature) → enters email → gets a 6-digit code by email →
-- enters the code + picks a password → a CRM agent account is created.
--
-- Two tables:
--   wk_agent_agreement — the editable agreement text + the on/off toggle
--                        (singleton, one row, id = 1).
--   wk_agent_signups   — one row per person who starts onboarding: their
--                        signature, the email code (hashed), and the agent
--                        account created at the end.
--
-- Both are admin-only (wk_is_admin). The public /join page never touches
-- these directly — it goes through the api/agent-onboarding/* routes which
-- use the service role and so bypass RLS.

-- ── Agreement + toggle (singleton) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_agent_agreement (
  id              int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  title           text NOT NULL DEFAULT 'Agent working agreement',
  intro           text NOT NULL DEFAULT 'Please read and sign below to join the team. This sets out how we work together. There is no cost to you.',
  -- terms = array of { heading, body } sections rendered on the sign page.
  terms           jsonb NOT NULL DEFAULT '[]'::jsonb,
  company         text NOT NULL DEFAULT 'HeyElsie',
  onboarding_open boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Seed the single row with a sensible default agreement Hugo can edit.
INSERT INTO wk_agent_agreement (id, title, intro, company, terms)
VALUES (
  1,
  'Agent working agreement',
  'Welcome aboard. Please read and sign below to join the team as a HeyElsie agent. This sets out how we work together. There is no cost to you, and you can stop at any time.',
  'HeyElsie',
  '[
    {"heading":"Your role","body":"You work as a remote agent on the HeyElsie CRM: making and taking calls, following up leads, and moving them through the pipeline. You will be given a login, a queue of leads, and the tools to work them."},
    {"heading":"How you are paid","body":"You are paid on the terms agreed with you separately (commission and/or hourly). Payment is made to the details you provide. You are responsible for your own tax."},
    {"heading":"Working honestly","body":"You represent HeyElsie professionally and honestly on every call and message. You follow the scripts and pipeline stages provided, and you never make promises on our behalf that have not been approved."},
    {"heading":"Confidentiality","body":"Lead lists, recordings, scripts, pricing and any customer data you see belong to HeyElsie. You keep them confidential and use them only for your work here. You do not copy, share or take them elsewhere."},
    {"heading":"No lock in","body":"There is no minimum term. Either side can end this at any time. On leaving, your access is removed and you return or delete any HeyElsie data you hold."}
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE wk_agent_agreement ENABLE ROW LEVEL SECURITY;

CREATE POLICY wk_agent_agreement_admin_all ON wk_agent_agreement
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());

-- ── Signups (onboarding funnel) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wk_agent_signups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  email           text NOT NULL,
  signature_png   text,
  -- signed → code_sent → created (the happy path). No account until 'created'.
  status          text NOT NULL DEFAULT 'signed'
                    CHECK (status IN ('signed', 'code_sent', 'created')),
  code_hash       text,
  code_expires_at timestamptz,
  attempts        int NOT NULL DEFAULT 0,
  agent_id        uuid,          -- the auth.users id once the account is made
  signed_at       timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wk_agent_signups_email_idx ON wk_agent_signups (lower(email));
CREATE INDEX IF NOT EXISTS wk_agent_signups_status_idx ON wk_agent_signups (status);

ALTER TABLE wk_agent_signups ENABLE ROW LEVEL SECURITY;

CREATE POLICY wk_agent_signups_admin_all ON wk_agent_signups
  FOR ALL TO authenticated USING (wk_is_admin()) WITH CHECK (wk_is_admin());
